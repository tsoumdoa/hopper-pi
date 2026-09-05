using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Hopper.Core;
using Hopper.Core.Dispatching;
using Hopper.Core.Grasshopper;
using Hopper.Core.Lifecycle;
using Hopper.Core.Operations;
using Hopper.Core.Protocol;
using Hopper.Core.Runtime;
using Hopper.Core.Time;
using Hopper.Rhino.Host;
using Rhino;

namespace rhino_zmq_poc
{
    internal sealed class BrowserAfterRunningCoordinator : IHopperRunningObserver, IDisposable
    {
        private readonly object _gate = new object();
        private readonly ManagedNodeChildProcess _child;
        private readonly IBrowserLauncher _browser;
        private readonly RuntimeStatusStore _status;
        private bool _running;

        public BrowserAfterRunningCoordinator(
            ManagedNodeChildProcess child,
            IBrowserLauncher browser,
            RuntimeStatusStore status)
        {
            _child = child;
            _browser = browser;
            _status = status;
            _child.Ready += OnReady;
        }

        public void Reset()
        {
            lock (_gate)
                _running = false;
        }

        public void OnRunning()
        {
            lock (_gate)
            {
                if (_status.Read().Lifecycle.State != Hopper.Core.Protocol.LifecycleState.running)
                    return;
                _running = true;
                var ready = _child.ReadyUri;
                if (ready != null)
                    Open(ready);
            }
        }

        public void Dispose()
        {
            _child.Ready -= OnReady;
        }

        private void OnReady(Uri ready)
        {
            lock (_gate)
            {
                if (!_running
                    || _status.Read().Lifecycle.State != Hopper.Core.Protocol.LifecycleState.running)
                    return;
                Open(ready);
            }
        }

        private void Open(Uri ready)
        {
            try
            {
                _browser.Open(ready);
            }
            catch (Exception exception)
            {
                _status.UpdateError(RuntimeStatusComponent.Host, new RuntimeErrorV2
                {
                    Code = RpcReasonCode.INTERNAL_ERROR,
                    Message = $"Could not open Hopper browser: {exception.Message}",
                });
            }
        }
    }

    internal sealed class RhinoHostComposition : IDisposable
    {
        private readonly RhinoOperationRegistry _rhinoRegistry;
        private readonly RhinoOperationAdapter _rhinoAdapter;
        private readonly HostDocumentStatusCoordinator _documentStatus;
        private readonly RhinoDocumentStatusMonitor _rhinoDocuments;
        private readonly RpcLifecycleTransport _transport;
        private readonly LifecycleController _lifecycle;
        private readonly ManagedNodeChildProcess _child;
        private readonly BrowserAfterRunningCoordinator _browser;
        private readonly HttpNodeHealthProbe _healthProbe;
        private readonly NodeHealthMonitor _healthMonitor;
        private int _disposed;

        private RhinoHostComposition(
            HopperHostFacade facade,
            RhinoOperationRegistry rhinoRegistry,
            RhinoOperationAdapter rhinoAdapter,
            HostDocumentStatusCoordinator documentStatus,
            RhinoDocumentStatusMonitor rhinoDocuments,
            RpcLifecycleTransport transport,
            LifecycleController lifecycle,
            ManagedNodeChildProcess child,
            BrowserAfterRunningCoordinator browser,
            HttpNodeHealthProbe healthProbe,
            NodeHealthMonitor healthMonitor)
        {
            Facade = facade;
            _rhinoRegistry = rhinoRegistry;
            _rhinoAdapter = rhinoAdapter;
            _documentStatus = documentStatus;
            _rhinoDocuments = rhinoDocuments;
            _transport = transport;
            _lifecycle = lifecycle;
            _child = child;
            _browser = browser;
            _healthProbe = healthProbe;
            _healthMonitor = healthMonitor;
        }

        public HopperHostFacade Facade { get; }

        public static RhinoHostComposition Create(string pluginDirectory)
        {
            if (string.IsNullOrWhiteSpace(pluginDirectory))
                throw new ArgumentException("Plugin directory is required.", nameof(pluginDirectory));

            var clock = SystemHopperClock.Instance;
            var uiScheduler = new RhinoUiCallbackScheduler();
            var dispatcher = new OrderedDispatcher(uiScheduler, clock);
            var grasshopper = HostOperationRegistries.Grasshopper;
            grasshopper.SetInstalled(GrasshopperInstallationProbe.IsInstalled(pluginDirectory));
            var rhino = HostOperationRegistries.Rhino;
            var rhinoAdapter = new RhinoOperationAdapter(new RhinoOperationExecutor(), clock);
            var status = new RuntimeStatusStore(clock, dispatcher.Status, grasshopper.Status);
            dispatcher.StatusChanged += dispatcherStatus => status.UpdateDispatcher(dispatcherStatus);
            var dispatcherDiagnostics = new RhinoDispatcherExecutionObserver(status);
            dispatcher.ExecutionRecorded += dispatcherDiagnostics.Record;
            var deferredOperations = new DeferredRpcOperationHandler();
            var transport = new RpcLifecycleTransport(
                dispatcher,
                deferredOperations,
                status,
                clock,
                new LoopbackEndpointSource());
            var applicationData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "hopper-pi");
            var profileFiles = new SystemInstanceProfileFileSystem();
            var profiles = new RhinoInstanceProfileStore(
                profileFiles,
                new UniqueAtomicWritePathProvider(),
                applicationData);
            var child = new ManagedNodeChildProcess(
                new HopperHostEntryResolver(pluginDirectory),
                Path.Combine(applicationData, "host"),
                status);
            var environment = new SystemNodeRuntimeEnvironment();
            var node = new NodeRuntimeResolver(
                new SystemNodeRuntimeFileSystem(),
                environment,
                SystemNodeRuntimeOsPathProvider.ForCurrentOperatingSystem(environment),
                new SystemNodeRuntimeProcessRunner());
            var lifecycleBackground = new ThreadPoolLifecycleBackgroundScheduler();
            _ = lifecycleBackground.Schedule(() =>
            {
                profiles.CleanupStaleProfiles();
                return Task.CompletedTask;
            });
            var lifecycle = new LifecycleController(
                node,
                transport,
                profiles,
                child,
                dispatcher,
                new CompositeAgentTransactionCleanup(
                    rhinoAdapter,
                    new RegisteredGrasshopperTransactionCleanup(grasshopper)),
                new GuidLifecycleInstanceIdSource(),
                lifecycleBackground,
                clock);
            var browser = new BrowserAfterRunningCoordinator(
                child,
                new BrowserLauncher(),
                status);
            var healthProbe = new HttpNodeHealthProbe(child, TimeSpan.FromSeconds(2));
            var healthMonitor = new NodeHealthMonitor(
                lifecycle,
                status,
                healthProbe,
                SystemHealthPollDelay.Instance,
                lifecycleBackground);
            var runningObservers = new CompositeHopperRunningObserver(browser, healthMonitor);
            var facade = new HopperHostFacade(
                lifecycle,
                lifecycleBackground,
                rhino,
                grasshopper,
                status,
                new RhinoGrasshopperStartController(),
                transport,
                runningObservers,
                new RhinoCommandCompletionSink(dispatcher),
                reopenBrowser: browser.OnRunning);
            deferredOperations.SetTarget(facade);

            HostDocumentStatusCoordinator documentStatus = null;
            RhinoDocumentStatusMonitor rhinoDocuments = null;
            try
            {
                if (!rhino.TryRegister(rhinoAdapter))
                    throw new InvalidOperationException("A different Rhino operation adapter is already registered.");

                documentStatus = new HostDocumentStatusCoordinator(status, grasshopper, transport);
                if (!HostOperationRegistries.DocumentStatus.TryRegister(documentStatus))
                    throw new InvalidOperationException("A different document status owner is already registered.");
                rhinoDocuments = new RhinoDocumentStatusMonitor(
                    HostOperationRegistries.DocumentStatus);

                // Create runs on Rhino's UI thread. If Grasshopper was already loaded,
                // its earlier report had no status owner and must be sampled once here.
                documentStatus.ReportRegisteredGrasshopperDocument();
                rhinoDocuments.Start();

                var composition = new RhinoHostComposition(
                    facade,
                    rhino,
                    rhinoAdapter,
                    documentStatus,
                    rhinoDocuments,
                    transport,
                    lifecycle,
                    child,
                    browser,
                    healthProbe,
                    healthMonitor);
                child.UnexpectedExit += composition.OnUnexpectedChildExit;
                return composition;
            }
            catch
            {
                rhinoDocuments?.Dispose();
                if (documentStatus != null)
                    HostOperationRegistries.DocumentStatus.TryUnregister(documentStatus);
                rhino.TryUnregister(rhinoAdapter);
                healthMonitor.Dispose();
                healthProbe.Dispose();
                browser.Dispose();
                transport.SignalStopNoWait();
                child.Dispose();
                throw;
            }
        }

        public void CloseForRhinoExit()
        {
            Facade.CloseForRhinoExit();
            Dispose();
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0)
                return;
            _child.UnexpectedExit -= OnUnexpectedChildExit;
            _rhinoDocuments.Dispose();
            HostOperationRegistries.DocumentStatus.TryUnregister(_documentStatus);
            _rhinoRegistry.TryUnregister(_rhinoAdapter);
            _healthMonitor.Dispose();
            _healthProbe.Dispose();
            _browser.Dispose();
            _transport.SignalStopNoWait();
            _child.Dispose();
        }

        private void OnUnexpectedChildExit()
        {
            _ = ObserveUnexpectedChildExitAsync();
        }

        private async Task ObserveUnexpectedChildExitAsync()
        {
            await _lifecycle.ReportUnexpectedChildExitAsync().ConfigureAwait(false);
            Facade.GetStatus();
        }
    }
}

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
    internal sealed class BrowserWhenAvailableCoordinator : IHopperRunningObserver, IDisposable
    {
        private readonly object _gate = new object();
        private readonly SharedHostProcessAdapter _child;
        private readonly LifecycleController _lifecycle;
        private readonly IBrowserLauncher _browser;
        private readonly RuntimeStatusStore _status;
        private readonly BrowserOpenRequest _openRequest = new();

        public BrowserWhenAvailableCoordinator(
            SharedHostProcessAdapter child,
            IBrowserLauncher browser,
            RuntimeStatusStore status,
            LifecycleController lifecycle)
        {
            _child = child;
            _browser = browser;
            _status = status;
            _lifecycle = lifecycle;
            _child.Ready += OnReady;
        }

        public void Reset()
        {
            lock (_gate)
            {
                // Only the first automatic worker startup suppresses UI. Consume the
                // process-local flag before spawning Node; later manual HopperCode opens normally.
                var workerStartup = Environment.GetEnvironmentVariable("HOPPER_RHINO_WORKER") == "1";
                Environment.SetEnvironmentVariable("HOPPER_RHINO_WORKER", null);
                _openRequest.Request(suppress: workerStartup);
            }
        }

        public void OnRunning() => OnReady(_child.ReadyUri);

        public void Reopen()
        {
            lock (_gate)
            {
                _openRequest.Request();
            }
            _ = EnsureAndOpenAsync();
        }

        private async Task EnsureAndOpenAsync()
        {
            try
            {
                await _child.EnsureRunningAsync().ConfigureAwait(false);
                OnRunning();
            }
            catch (Exception exception)
            {
                _status.UpdateError(RuntimeStatusComponent.Host, new RuntimeErrorV2
                {
                    Code = RpcReasonCode.INTERNAL_ERROR,
                    Message = $"Could not reopen Hopper: {exception.Message}",
                });
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
                if (_lifecycle.Snapshot.State is not (Hopper.Core.Lifecycle.LifecycleState.Starting
                    or Hopper.Core.Lifecycle.LifecycleState.Running)) return;
                if (_openRequest.Take(true, ready))
                    Open(ready);
            }
        }

        private void Open(Uri ready)
        {
            try
            {
                if (SharedNativeHost.MessageDocumentSerialNumber is { } serial)
                {
                    var documentId = $"{DocumentSession.LifecycleInstanceId}:rhino:{serial}";
                    var builder = new UriBuilder(ready);
                    builder.Query = builder.Query.TrimStart('?') + "&document=" + Uri.EscapeDataString(documentId);
                    ready = builder.Uri;
                }
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
        private readonly SharedHostProcessAdapter _child;
        private readonly BrowserWhenAvailableCoordinator _browser;
        private int _disposed;

        private RhinoHostComposition(
            HopperHostFacade facade,
            RhinoOperationRegistry rhinoRegistry,
            RhinoOperationAdapter rhinoAdapter,
            HostDocumentStatusCoordinator documentStatus,
            RhinoDocumentStatusMonitor rhinoDocuments,
            RpcLifecycleTransport transport,
            SharedHostProcessAdapter child,
            BrowserWhenAvailableCoordinator browser)
        {
            Facade = facade;
            _rhinoRegistry = rhinoRegistry;
            _rhinoAdapter = rhinoAdapter;
            _documentStatus = documentStatus;
            _rhinoDocuments = rhinoDocuments;
            _transport = transport;
            _child = child;
            _browser = browser;
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
            var child = new SharedHostProcessAdapter(
                new HopperHostEntryResolver(pluginDirectory),
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
            var browser = new BrowserWhenAvailableCoordinator(
                child,
                new BrowserLauncher(),
                status,
                lifecycle);
            var facade = new HopperHostFacade(
                lifecycle,
                lifecycleBackground,
                rhino,
                grasshopper,
                status,
                new RhinoGrasshopperStartController(),
                transport,
                browser,
                new RhinoCommandCompletionSink(dispatcher),
                reopenBrowser: browser.Reopen,
                getBrowserUri: () => child.IsAlive ? child.ReadyUri : null);
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
                    child,
                    browser);
                return composition;
            }
            catch
            {
                rhinoDocuments?.Dispose();
                if (documentStatus != null)
                    HostOperationRegistries.DocumentStatus.TryUnregister(documentStatus);
                rhino.TryUnregister(rhinoAdapter);
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
            _rhinoDocuments.Dispose();
            HostOperationRegistries.DocumentStatus.TryUnregister(_documentStatus);
            _rhinoRegistry.TryUnregister(_rhinoAdapter);
            _browser.Dispose();
            _transport.SignalStopNoWait();
            _child.Dispose();
        }

    }
}

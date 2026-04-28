using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Grasshopper;
using Grasshopper.Kernel;
using NetMQ;
using NetMQ.Sockets;
using Rhino;

namespace rhino_zmq_poc
{
    #region Message Types

    public class Position
    {
        [JsonPropertyName("x")]
        public double X { get; set; }

        [JsonPropertyName("y")]
        public double Y { get; set; }
    }

    public class PortRef
    {
        [JsonPropertyName("componentId")]
        public string ComponentId { get; set; }

        [JsonPropertyName("port")]
        public string Port { get; set; }
    }

    public class GhCommand
    {
        [JsonPropertyName("action")]
        public string Action { get; set; }

        [JsonPropertyName("params")]
        public JsonElement Params { get; set; }
    }

    public class SubmitJobRequest
    {
        [JsonPropertyName("type")]
        public string Type { get; set; }

        [JsonPropertyName("jobId")]
        public string JobId { get; set; }

        [JsonPropertyName("command")]
        public GhCommand Command { get; set; }
    }

    public class SubmitJobResponse
    {
        [JsonPropertyName("status")]
        public string Status { get; set; }

        [JsonPropertyName("jobId")]
        public string JobId { get; set; }

        [JsonPropertyName("commandId")]
        public string CommandId { get; set; }

        [JsonPropertyName("queuedAt")]
        public long QueuedAt { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; }
    }

    public class GhJobStatus
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "gh.job.status";

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }

        [JsonPropertyName("jobId")]
        public string JobId { get; set; }

        [JsonPropertyName("commandId")]
        public string CommandId { get; set; }

        [JsonPropertyName("state")]
        public string State { get; set; }

        [JsonPropertyName("progress")]
        public int Progress { get; set; }

        [JsonPropertyName("error")]
        public string Error { get; set; }
    }

    public class GhEventXml
    {
        [JsonPropertyName("type")]
        public string Type { get; set; } = "gh.event.xml";

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }

        [JsonPropertyName("docName")]
        public string DocName { get; set; }

        [JsonPropertyName("xml")]
        public string Xml { get; set; }
    }

    public class CommandResult
    {
        [JsonPropertyName("executed")]
        public bool Executed { get; set; }

        [JsonPropertyName("action")]
        public string Action { get; set; }

        [JsonPropertyName("output")]
        public string Output { get; set; }

        [JsonPropertyName("timestamp")]
        public long Timestamp { get; set; }
    }

    #endregion

    #region Job Queue

    public enum JobState
    {
        Queued,
        Running,
        Completed,
        Failed,
        Cancelled
    }

    public class Job
    {
        public string JobId { get; set; }
        public string CommandId { get; set; }
        public GhCommand Command { get; set; }
        public JobState State { get; set; }
        public int Progress { get; set; }
        public string Error { get; set; }
        public long QueuedAt { get; set; }
        public long StartedAt { get; set; }
        public long CompletedAt { get; set; }
    }

    public class JobQueue : IDisposable
    {
        private readonly Queue<Job> _jobs = new Queue<Job>();
        private readonly object _lock = new object();
        private Job _currentJob;
        private readonly ManualResetEventSlim _jobAvailable = new ManualResetEventSlim(false);
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private Task _processingTask;

        public event Action<GhJobStatus> OnStatusChanged;

        public void Enqueue(Job job)
        {
            lock (_lock)
            {
                job.State = JobState.Queued;
                job.QueuedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                _jobs.Enqueue(job);
            }
            _jobAvailable.Set();
            EmitStatus(job);
        }

        public void Start()
        {
            _processingTask = Task.Run(ProcessJobs);
        }

        private void ProcessJobs()
        {
            while (!_cts.Token.IsCancellationRequested)
            {
                _jobAvailable.Wait(_cts.Token);

                Job job = null;
                lock (_lock)
                {
                    if (_jobs.Count > 0)
                    {
                        job = _jobs.Dequeue();
                        if (_jobs.Count == 0)
                            _jobAvailable.Reset();
                    }
                }

                if (job != null)
                {
                    ExecuteJob(job);
                }
            }
        }

        private void ExecuteJob(Job job)
        {
            job.State = JobState.Running;
            job.StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            EmitStatus(job);

            try
            {
                job.Progress = 50;
                EmitStatus(job);

                string result = RhinoZmqPlugin.Instance?.Component?.ExecuteCommand(job.Command) ?? "Plugin not initialized";

                job.Progress = 100;
                job.State = JobState.Completed;
                job.CompletedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                EmitStatus(job);
            }
            catch (Exception ex)
            {
                job.State = JobState.Failed;
                job.Error = ex.Message;
                job.CompletedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                EmitStatus(job);
            }
        }

        private void EmitStatus(Job job)
        {
            OnStatusChanged?.Invoke(new GhJobStatus
            {
                JobId = job.JobId,
                CommandId = job.CommandId,
                State = job.State.ToString().ToLower(),
                Progress = job.Progress,
                Error = job.Error,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            });
        }

        public void Dispose()
        {
            _cts.Cancel();
            _jobAvailable.Set();
            _processingTask?.Wait(TimeSpan.FromSeconds(2));
            _cts.Dispose();
            _jobAvailable.Dispose();
        }
    }

    #endregion

    #region ZMQ Service

    public class ZMqService : IDisposable
    {
        private const string PubEndpoint = "tcp://*:5555";
        private const string RouterEndpoint = "tcp://*:5556";

        private PublisherSocket _pubSocket;
        private RouterSocket _routerSocket;
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private Task _routerTask;
        private readonly JobQueue _jobQueue;
        private readonly ConcurrentQueue<(string topic, string json)> _publishQueue = new ConcurrentQueue<(string, string)>();

        public event Action<GhJobStatus> OnJobStatus;
        public event Action<string> OnDebugLog;
        public event Action<string> OnJobReceived;

        public ZMqService(JobQueue jobQueue)
        {
            _jobQueue = jobQueue;
            _jobQueue.OnStatusChanged += status =>
            {
                OnJobStatus?.Invoke(status);
                EnqueuePublish("gh.job.status", JsonSerializer.Serialize(status));
            };
        }

        public void Start()
        {
            try
            {
                _pubSocket = new PublisherSocket();
                _pubSocket.Bind(PubEndpoint);
                DebugLog($"[PUB] Bound to {PubEndpoint}");

                _routerSocket = new RouterSocket();
                _routerSocket.Bind(RouterEndpoint);
                DebugLog($"[ROUTER] Bound to {RouterEndpoint}");

                _routerTask = Task.Run(() => RouterLoop(_cts.Token));
            }
            catch (Exception ex)
            {
                DebugLog($"[ZMQ] Start error: {ex.Message}");
            }
        }

        private void RouterLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    byte[] identity;
                    if (!_routerSocket.TryReceiveFrameBytes(TimeSpan.FromSeconds(1), out identity))
                    {
                        DrainPublishQueue();
                        continue;
                    }

                    var message = _routerSocket.ReceiveFrameString();
                    DebugLog($"[ROUTER] Received: {message}");

                    var response = ProcessRequest(message);
                    _routerSocket.SendFrame(identity, true);
                    _routerSocket.SendFrame(response);
                    DebugLog($"[ROUTER] Sent: {response}");

                    DrainPublishQueue();
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    DebugLog($"[ROUTER] Error: {ex.Message}");
                }
            }
        }

        private void DrainPublishQueue()
        {
            while (_publishQueue.TryDequeue(out var item))
            {
                try
                {
                    _pubSocket.SendFrame(item.topic, true);
                    _pubSocket.SendFrame(item.json);
                    DebugLog($"[PUB] Published {item.topic}");
                }
                catch (Exception ex)
                {
                    DebugLog($"[PUB] Publish error: {ex.Message}");
                }
            }
        }

        private void EnqueuePublish(string topic, string json)
        {
            _publishQueue.Enqueue((topic, json));
        }

        private string ProcessRequest(string message)
        {
            try
            {
                var request = JsonSerializer.Deserialize<SubmitJobRequest>(message);
                if (request == null || request.Command == null)
                {
                    return JsonSerializer.Serialize(new SubmitJobResponse
                    {
                        Status = "error",
                        Error = "Invalid request"
                    });
                }

                if (request.Type != "submitJob")
                {
                    return JsonSerializer.Serialize(new SubmitJobResponse
                    {
                        Status = "error",
                        Error = $"Unknown request type: {request.Type}"
                    });
                }

                string commandId = $"cmd-{Guid.NewGuid().ToString()[..8]}";

                var job = new Job
                {
                    JobId = request.JobId,
                    CommandId = commandId,
                    Command = request.Command
                };

                _jobQueue.Enqueue(job);

                OnJobReceived?.Invoke($"{job.JobId}|{job.CommandId}|{job.Command.Action}");

                return JsonSerializer.Serialize(new SubmitJobResponse
                {
                    Status = "ok",
                    JobId = job.JobId,
                    CommandId = commandId,
                    QueuedAt = job.QueuedAt
                });
            }
            catch (Exception ex)
            {
                return JsonSerializer.Serialize(new SubmitJobResponse
                {
                    Status = "error",
                    Error = ex.Message
                });
            }
        }

        public void PublishXmlEvent(string docName, string xml)
        {
            if (_pubSocket == null) return;

            var evt = new GhEventXml
            {
                DocName = docName,
                Xml = xml,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };

            EnqueuePublish("gh.event.xml", JsonSerializer.Serialize(evt));
            DebugLog($"[PUB] Queued gh.event.xml for {docName}");
        }

        private void PublishJobStatus(GhJobStatus status)
        {
            if (_pubSocket == null) return;

            EnqueuePublish("gh.job.status", JsonSerializer.Serialize(status));
            DebugLog($"[PUB] Queued gh.job.status: {status.State}");
        }

        private void DebugLog(string msg)
        {
            OnDebugLog?.Invoke(msg);
        }

        public void Dispose()
        {
            _cts.Cancel();
            _routerTask?.Wait(TimeSpan.FromSeconds(2));
            _pubSocket?.Dispose();
            _routerSocket?.Dispose();
            _cts.Dispose();
            DebugLog("[ZMQ] Disposed");
        }
    }

    #endregion

    #region Main Component

    public class rhino_zmq_pocComponent : GH_Component
    {
        private ZMqService _zmqService;
        private JobQueue _jobQueue;
        private string _debugLog = "";
        private string _lastJobReceived = "";
        private string _lastXmlSent = "";
        private GH_Document _subscribedDoc;

        public rhino_zmq_pocComponent()
            : base("GH ZMQ Plugin", "GHZMQ",
                "CLI-GH Connector: ZMQ pub/sub and command execution",
                "CLI-GH", "Commands")
        {
        }

        protected override void RegisterInputParams(GH_Component.GH_InputParamManager pManager)
        {
        }

        protected override void RegisterOutputParams(GH_Component.GH_OutputParamManager pManager)
        {
            pManager.AddTextParameter("Debug Log", "LOG", "ZMQ debug output", GH_ParamAccess.list);
            pManager.AddTextParameter("Job Received", "JOB", "Last received job (jobId|commandId|action)", GH_ParamAccess.item);
            pManager.AddTextParameter("Last XML", "XML", "Last published XML snapshot", GH_ParamAccess.item);
        }

        protected override void BeforeSolveInstance()
        {
            if (_zmqService == null)
            {
                InitializeZmq();
            }
            EnsureSolutionEvents();
        }

        private void InitializeZmq()
        {
            _debugLog = $"[{DateTime.Now:HH:mm:ss}] Initializing ZMQ...\n";
            _jobQueue = new JobQueue();
            _zmqService = new ZMqService(_jobQueue);
            _zmqService.OnDebugLog += msg => _debugLog += $"[{DateTime.Now:HH:mm:ss}] {msg}\n";
            _zmqService.OnJobStatus += status => _debugLog += $"[{DateTime.Now:HH:mm:ss}] Job {status.JobId}: {status.State}\n";
            _zmqService.OnJobReceived += info =>
            {
                _lastJobReceived = info;
                RhinoApp.Idle += OnIdleExpire;
            };
            _zmqService.Start();
            _jobQueue.Start();
            RhinoZmqPlugin.Instance.Component = this;
            SubscribeSolutionEvents();
            _debugLog += $"[{DateTime.Now:HH:mm:ss}] ZMQ started: PUB @ 5555, ROUTER @ 5556\n";
        }

        private void OnIdleExpire(object sender, EventArgs e)
        {
            RhinoApp.Idle -= OnIdleExpire;
            ExpireSolution(true);
        }

        private void SubscribeSolutionEvents()
        {
            GH_Document doc = GetCurrentDocument();
            if (doc == null) return;

            UnsubscribeSolutionEvents();

            doc.SolutionEnd += OnSolutionEnd;
            _subscribedDoc = doc;
            _debugLog += $"[{DateTime.Now:HH:mm:ss}] Subscribed to SolutionEnd\n";
        }

        private void UnsubscribeSolutionEvents()
        {
            if (_subscribedDoc != null)
            {
                _subscribedDoc.SolutionEnd -= OnSolutionEnd;
            }
        }

        private void EnsureSolutionEvents()
        {
            GH_Document current = GetCurrentDocument();
            if (current == null) return;
            if (_subscribedDoc != current)
            {
                SubscribeSolutionEvents();
            }
        }

        private GH_Document GetCurrentDocument()
        {
            return Instances.ActiveDocument;
        }

        private void OnSolutionEnd(object sender, EventArgs e)
        {
            var doc = sender as GH_Document;
            PublishDocumentXml(doc);
        }

        private void PublishDocumentXml(GH_Document doc)
        {
            if (doc == null)
            {
                doc = GetCurrentDocument();
            }
            if (doc == null) return;

            try
            {
                var archive = new GH_IO.Serialization.GH_Archive();
                archive.AppendObject(doc, "Definition");
                string xml = archive.Serialize_Xml();
                _lastXmlSent = xml;
                _zmqService?.PublishXmlEvent(doc.FilePath ?? "Untitled.gh", xml);
                _debugLog += $"[{DateTime.Now:HH:mm:ss}] Sending XML: {xml.Length} chars, topic=gh.event.xml\n";
            }
            catch (Exception ex)
            {
                _debugLog += $"[{DateTime.Now:HH:mm:ss}] XML publish error: {ex.Message}\n";
            }
        }

        public string ExecuteCommand(GhCommand command)
        {
            if (command == null || string.IsNullOrEmpty(command.Action))
                return "Invalid command: missing action";

            _debugLog += $"[{DateTime.Now:HH:mm:ss}] Executing: {command.Action}\n";

            string result = command.Action switch
            {
                "addComponent" => MockAddComponent(command.Params),
                "deleteComponent" => MockDeleteComponent(command.Params),
                "connectWire" => MockConnectWire(command.Params),
                "disconnectWire" => MockDisconnectWire(command.Params),
                "moveComponent" => MockMoveComponent(command.Params),
                "renameComponent" => MockRenameComponent(command.Params),
                "setComponentLocked" => MockSetComponentLocked(command.Params),
                "setComponentHidden" => MockSetComponentHidden(command.Params),
                "addGroup" => MockAddGroup(command.Params),
                "removeFromGroup" => MockRemoveFromGroup(command.Params),
                "setSliderValue" => MockSetSliderValue(command.Params),
                "setPanelText" => MockSetPanelText(command.Params),
                _ => $"Unknown action: {command.Action}"
            };

            _debugLog += $"[{DateTime.Now:HH:mm:ss}] Result: {result}\n";
            return result;
        }

        protected override void SolveInstance(IGH_DataAccess DA)
        {
            var logLines = _debugLog.Split('\n').Where(l => !string.IsNullOrEmpty(l)).ToArray();
            DA.SetDataList(0, logLines);
            DA.SetData(1, _lastJobReceived);
            DA.SetData(2, _lastXmlSent);
        }

        #region Mock Commands

        private string MockAddComponent(JsonElement p) =>
            $"MOCK: addComponent - would add {p.GetProperty("componentType").GetString()}";

        private string MockDeleteComponent(JsonElement p) =>
            $"MOCK: deleteComponent - would delete {p.GetProperty("targetId").GetString()}";

        private string MockConnectWire(JsonElement p) =>
            $"MOCK: connectWire - would connect {p.GetProperty("from").GetProperty("componentId")} -> {p.GetProperty("to").GetProperty("componentId")}";

        private string MockDisconnectWire(JsonElement p) =>
            $"MOCK: disconnectWire - would disconnect";

        private string MockMoveComponent(JsonElement p) =>
            $"MOCK: moveComponent - would move {p.GetProperty("targetId").GetString()}";

        private string MockRenameComponent(JsonElement p) =>
            $"MOCK: renameComponent - would rename {p.GetProperty("targetId").GetString()} to {p.GetProperty("nickName").GetString()}";

        private string MockSetComponentLocked(JsonElement p) =>
            $"MOCK: setComponentLocked - would set locked={p.GetProperty("locked").GetBoolean()}";

        private string MockSetComponentHidden(JsonElement p) =>
            $"MOCK: setComponentHidden - would set hidden={p.GetProperty("hidden").GetBoolean()}";

        private string MockAddGroup(JsonElement p) =>
            $"MOCK: addGroup - would add group {p.GetProperty("groupName").GetString()}";

        private string MockRemoveFromGroup(JsonElement p) =>
            $"MOCK: removeFromGroup - would remove from group";

        private string MockSetSliderValue(JsonElement p) =>
            $"MOCK: setSliderValue - would set {p.GetProperty("targetId").GetString()} = {p.GetProperty("value").GetDouble()}";

        private string MockSetPanelText(JsonElement p) =>
            $"MOCK: setPanelText - would set {p.GetProperty("targetId").GetString()} = \"{p.GetProperty("text").GetString()}\"";

        #endregion

        public override GH_Exposure Exposure => GH_Exposure.primary;

        protected override System.Drawing.Bitmap Icon => null;

        public override Guid ComponentGuid => new Guid("e07753b1-fdec-417a-b57a-83a95204a8dd");

        private void Cleanup()
        {
            _zmqService?.Dispose();
            _jobQueue?.Dispose();
            RhinoZmqPlugin.Instance = null;
            _zmqService = null;
            _jobQueue = null;
        }
    }

    #endregion

    #region Plugin Entry Point

    public class RhinoZmqPlugin
    {
        private static RhinoZmqPlugin _instance = new RhinoZmqPlugin();
        public static RhinoZmqPlugin Instance
        {
            get => _instance;
            set => _instance = value;
        }

        public rhino_zmq_pocComponent Component { get; set; }
    }

    #endregion
}
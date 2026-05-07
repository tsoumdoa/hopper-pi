using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Grasshopper;
using NetMQ;
using NetMQ.Sockets;

namespace rhino_zmq_poc
{
    public class ZMqService : IDisposable
    {
        private const string PubEndpoint = "tcp://*:5555";
        private const string PullEndpoint = "tcp://*:5556";
        private const string RepEndpoint = "tcp://*:5557";

        private PublisherSocket _pubSocket;
        private PullSocket _pullSocket;
        private ResponseSocket _repSocket;
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private Task _commandTask;
        private Task _repTask;
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

                _pullSocket = new PullSocket();
                _pullSocket.Bind(PullEndpoint);
                DebugLog($"[PULL] Bound to {PullEndpoint}");

                _repSocket = new ResponseSocket();
                _repSocket.Bind(RepEndpoint);
                DebugLog($"[REP] Bound to {RepEndpoint}");

                _commandTask = Task.Run(() => CommandLoop(_cts.Token));
                _repTask = Task.Run(() => RepLoop(_cts.Token));
            }
            catch (Exception ex)
            {
                DebugLog($"[ZMQ] Start error: {ex.Message}");
            }
        }

        private void CommandLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    string message;
                    if (!_pullSocket.TryReceiveFrameString(TimeSpan.FromSeconds(1), out message))
                    {
                        DrainPublishQueue();
                        continue;
                    }

                    DebugLog($"[PULL] Received: {message}");

                    ProcessCommand(message);

                    DrainPublishQueue();
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    DebugLog($"[PULL] Error: {ex.Message}");
                }
            }
        }

        private void ProcessCommand(string message)
        {
            try
            {
                var request = JsonSerializer.Deserialize<SubmitJobRequest>(message);
                if (request == null || request.Command == null)
                {
                    DebugLog("[PULL] Invalid request: null or missing command");
                    return;
                }

                if (request.Type != "submitJob")
                {
                    DebugLog($"[PULL] Unknown request type: {request.Type}");
                    return;
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

                DebugLog($"[PULL] Enqueued job {job.JobId} ({commandId})");
            }
            catch (Exception ex)
            {
                DebugLog($"[PULL] Process error: {ex.Message}");
            }
        }

        private void RepLoop(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    string message = _repSocket.ReceiveFrameString();
                    DebugLog($"[REP] Received: {message}");

                    var response = HandleRequest(message);

                    _repSocket.SendFrame(response);
                    DebugLog($"[REP] Sent response");
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    DebugLog($"[REP] Error: {ex.Message}");
                }
            }
        }

        private string HandleRequest(string message)
        {
            try
            {
                using var doc = JsonDocument.Parse(message);
                var type = doc.RootElement.GetProperty("type").GetString();

                if (type == "listAllComponents")
                {
                    var components = new List<GhComponentInfo>();

                    foreach (var proxy in Instances.ComponentServer.ObjectProxies)
                    {
                        var d = proxy.Desc;
                        if (d == null) continue;

                        string pluginName = "Unknown";
                        string assemblyName = "Unknown";

                        try
                        {
                            if (!string.IsNullOrEmpty(proxy.Location))
                            {
                                assemblyName =
                                    System.IO.Path.GetFileNameWithoutExtension(proxy.Location);
                            }

                            foreach (var lib in Instances.ComponentServer.Libraries)
                            {
                                if (lib == null || lib.Assembly == null) continue;

                                string libLocation = "";
                                try { libLocation = lib.Assembly.Location; }
                                catch { }

                                if (!string.IsNullOrEmpty(libLocation) &&
                                    string.Equals(libLocation, proxy.Location,
                                        StringComparison.OrdinalIgnoreCase))
                                {
                                    pluginName = lib.Name;
                                    break;
                                }
                            }
                        }
                        catch
                        {
                        }

                        components.Add(new GhComponentInfo
                        {
                            Name = d.Name,
                            Guid = proxy.Guid.ToString(),
                            PluginName = pluginName,
                            AssemblyName = assemblyName,
                            Category = d.Category,
                            SubCategory = d.SubCategory,
                            Description = d.Description
                        });
                    }

                    var response = new ListAllComponentsResponse
                    {
                        Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        Components = components
                    };

                    return JsonSerializer.Serialize(response);
                }

                return JsonSerializer.Serialize(new { error = $"Unknown request type: {type}" });
            }
            catch (Exception ex)
            {
                DebugLog($"[REP] HandleRequest error: {ex.Message}");
                return JsonSerializer.Serialize(new { error = ex.Message });
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

        private void DebugLog(string msg)
        {
            OnDebugLog?.Invoke(msg);
        }

        public void Dispose()
        {
            _cts.Cancel();
            _commandTask?.Wait(TimeSpan.FromSeconds(2));
            _repTask?.Wait(TimeSpan.FromSeconds(2));
            _pubSocket?.Dispose();
            _pullSocket?.Dispose();
            _repSocket?.Dispose();
            _cts.Dispose();
            DebugLog("[ZMQ] Disposed");
        }
    }
}

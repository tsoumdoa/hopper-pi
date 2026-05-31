using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace rhino_zmq_poc
{
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
                try
                {
                    _jobAvailable.Wait(_cts.Token);
                }
                catch (OperationCanceledException)
                {
                    break;
                }

                if (_cts.Token.IsCancellationRequested)
                    break;

                var batch = new List<Job>();
                lock (_lock)
                {
                    while (_jobs.Count > 0)
                        batch.Add(_jobs.Dequeue());
                    _jobAvailable.Reset();
                }

                if (batch.Count == 0)
                    continue;

                if (_cts.Token.IsCancellationRequested)
                {
                    FailBatch(batch, "Service shutting down");
                    continue;
                }

                try
                {
                    Utilities.RunOnUiThread(() => ExecuteBatch(batch), TimeSpan.FromSeconds(5));
                }
                catch (Exception ex)
                {
                    FailBatch(batch, ex.Message);
                }
            }
        }

        private void FailBatch(List<Job> batch, string error)
        {
            foreach (var job in batch)
            {
                if (job.State == JobState.Completed)
                    continue;

                job.State = JobState.Failed;
                job.Error = error;
                job.CompletedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                EmitStatus(job);
            }
        }

        private void ExecuteBatch(List<Job> batch)
        {
            foreach (var job in batch)
            {
                job.State = JobState.Running;
                job.StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                EmitStatus(job);

                try
                {
                    var result = RhinoZmqPlugin.Instance?.Component?.ExecuteCommand(job.Command) ?? "";
                    if (result.IndexOf(" error:", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        job.State = JobState.Failed;
                        job.Error = result;
                    }
                    else
                    {
                        job.Progress = 100;
                        job.State = JobState.Completed;
                    }
                }
                catch (Exception ex)
                {
                    job.State = JobState.Failed;
                    job.Error = ex.Message;
                }

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

        public void StopFast()
        {
            _cts.Cancel();
            _jobAvailable.Set();
        }

        public void Dispose()
        {
            StopFast();

            var processingTask = _processingTask;
            _processingTask = null;

            _ = Task.Run(() =>
            {
                try
                {
                    processingTask?.Wait(TimeSpan.FromSeconds(2));
                }
                catch
                {
                    // Best effort while shutting down.
                }
            });
        }
    }
}
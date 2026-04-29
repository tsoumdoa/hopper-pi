using System;
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
        private readonly System.Collections.Generic.Queue<Job> _jobs = new System.Collections.Generic.Queue<Job>();
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
}
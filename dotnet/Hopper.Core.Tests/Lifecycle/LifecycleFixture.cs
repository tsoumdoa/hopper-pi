using Hopper.Core.Lifecycle;
using Hopper.Core.Tests.TestDoubles;

namespace Hopper.Core.Tests.Lifecycle;

internal sealed class LifecycleFixture
{
    public LifecycleFixture()
    {
        Controller = new LifecycleController(
            Node,
            Transport,
            Profiles,
            Child,
            Dispatcher,
            Transactions,
            InstanceIds,
            Background,
            Clock);
        AttachCallLog();
        Calls.Clear();
    }

    public List<string> Calls { get; } = new();
    public ManualClock Clock { get; } =
        new(new DateTimeOffset(2026, 3, 4, 5, 6, 7, TimeSpan.Zero));
    public FakeNodeRuntimeProvider Node { get; } = new();
    public FakeLifecycleTransport Transport { get; } = new();
    public FakeProfileStore Profiles { get; } = new();
    public FakeChildProcess Child { get; } = new();
    public FakeLifecycleDispatcher Dispatcher { get; } = new();
    public FakeTransactionCleanup Transactions { get; } = new();
    public FakeInstanceIdSource InstanceIds { get; } = new();
    public ILifecycleBackgroundScheduler Background { get; } =
        new ThreadPoolLifecycleBackgroundScheduler();
    public LifecycleController Controller { get; }

    private void AttachCallLog()
    {
        Node.Calls = Calls;
        Transport.Calls = Calls;
        Profiles.Calls = Calls;
        Child.Calls = Calls;
        Dispatcher.Calls = Calls;
        Transactions.Calls = Calls;
    }
}

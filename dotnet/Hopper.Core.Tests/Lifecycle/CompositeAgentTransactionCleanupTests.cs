using Hopper.Core.Lifecycle;
using Xunit;

namespace Hopper.Core.Tests.Lifecycle;

public sealed class CompositeAgentTransactionCleanupTests
{
    [Fact]
    public void RunsEveryCleanupInOrder()
    {
        var calls = new List<string>();
        var cleanup = new CompositeAgentTransactionCleanup(
            new StubCleanup("rhino", calls),
            new StubCleanup("grasshopper", calls));

        cleanup.CleanupOpenTransactions();

        Assert.Equal(new[] { "rhino", "grasshopper" }, calls);
    }

    [Fact]
    public void RunsLaterCleanupsAndAggregatesFailures()
    {
        var calls = new List<string>();
        var cleanup = new CompositeAgentTransactionCleanup(
            new StubCleanup("rhino", calls, new InvalidOperationException("undo failed")),
            new StubCleanup("grasshopper", calls));

        var error = Assert.Throws<AggregateException>(cleanup.CleanupOpenTransactions);

        Assert.Equal(new[] { "rhino", "grasshopper" }, calls);
        Assert.Single(error.InnerExceptions);
        Assert.Equal("undo failed", error.InnerExceptions[0].Message);
    }

    private sealed class StubCleanup : IAgentTransactionCleanup
    {
        private readonly string _name;
        private readonly List<string> _calls;
        private readonly Exception? _failure;

        public StubCleanup(string name, List<string> calls, Exception? failure = null)
        {
            _name = name;
            _calls = calls;
            _failure = failure;
        }

        public void CleanupOpenTransactions()
        {
            _calls.Add(_name);
            if (_failure != null)
                throw _failure;
        }
    }
}

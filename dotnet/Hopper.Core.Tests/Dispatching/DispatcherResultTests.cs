using Hopper.Core.Dispatching;
using Xunit;

namespace Hopper.Core.Tests.Dispatching;

public class DispatcherResultTests
{
    [Theory]
    [InlineData(DispatcherResultKind.Completed, "OK")]
    [InlineData(DispatcherResultKind.Failed, "OPERATION_FAILED")]
    [InlineData(DispatcherResultKind.Busy, "DISPATCHER_BUSY")]
    [InlineData(DispatcherResultKind.DeadlineExceededBeforeStart, "START_DEADLINE_EXCEEDED")]
    [InlineData(DispatcherResultKind.CancelledBeforeStart, "CANCELLED_BEFORE_START")]
    [InlineData(DispatcherResultKind.ShuttingDown, "SHUTTING_DOWN")]
    public void CodesMatchFrozenRpcV2ReasonCodes(DispatcherResultKind kind, string expected)
    {
        var result = CreateResult(kind);

        Assert.Equal(kind, result.Kind);
        Assert.Equal(expected, result.Code);
    }

    private static DispatcherResult<int> CreateResult(DispatcherResultKind kind) => kind switch
    {
        DispatcherResultKind.Completed => DispatcherResult<int>.Completed(1),
        DispatcherResultKind.Failed =>
            DispatcherResult<int>.Failed(new InvalidOperationException("failure")),
        DispatcherResultKind.Busy => DispatcherResult<int>.Busy(1, 2),
        DispatcherResultKind.DeadlineExceededBeforeStart =>
            DispatcherResult<int>.DeadlineExceededBeforeStart(),
        DispatcherResultKind.CancelledBeforeStart =>
            DispatcherResult<int>.CancelledBeforeStart(),
        DispatcherResultKind.ShuttingDown => DispatcherResult<int>.ShuttingDown(),
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, null),
    };
}

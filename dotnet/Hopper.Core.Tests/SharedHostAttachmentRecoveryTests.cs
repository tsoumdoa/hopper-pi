using Hopper.Core.Runtime;
using Xunit;

namespace Hopper.Core.Tests;

public sealed class SharedHostAttachmentRecoveryTests
{
    [Fact]
    public async Task ExplicitReopenRestartsStoppedHostButDoesNotReregisterHealthyAttachment()
    {
        var running = false;
        var epoch = 1;
        var registeredEpoch = 1;
        var registrations = 0;
        var explicitStarts = new List<bool>();
        var recovery = new SharedHostAttachmentRecovery(
            (explicitStart, _) =>
            {
                explicitStarts.Add(explicitStart);
                if (!running)
                {
                    if (!explicitStart) throw new InvalidOperationException("Host intentionally stopped");
                    running = true;
                    epoch++;
                }
                return Task.CompletedTask;
            },
            () => registeredEpoch == epoch,
            _ => { registeredEpoch = epoch; registrations++; return Task.CompletedTask; });

        await Assert.ThrowsAsync<InvalidOperationException>(() => recovery.EnsureAsync(false, false, default));
        Assert.False(running);
        await recovery.EnsureAsync(true, false, default);
        Assert.True(running);
        Assert.Equal(1, registrations);
        await recovery.EnsureAsync(true, false, default);
        Assert.Equal(1, registrations);
        Assert.Equal(new[] { false, true, true }, explicitStarts);
    }

    [Fact]
    public async Task ConcurrentReopenAndReconnectRegisterReplacementOnlyOnce()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var registered = false;
        var registrations = 0;
        var recovery = new SharedHostAttachmentRecovery(
            (_, _) => Task.CompletedTask,
            () => registered,
            async _ => { entered.SetResult(); await release.Task; registered = true; registrations++; });
        var reopen = recovery.EnsureAsync(true, false, default);
        await entered.Task;
        var reconnect = recovery.EnsureAsync(false, false, default);
        Assert.False(reconnect.IsCompleted);
        release.SetResult();
        await Task.WhenAll(reopen, reconnect);
        Assert.Equal(1, registrations);
    }

    [Fact]
    public async Task RhinoStopDuringDiscoveryPreventsLateRegistration()
    {
        using var lifetime = new CancellationTokenSource();
        var registrations = 0;
        var recovery = new SharedHostAttachmentRecovery(
            (_, _) => { lifetime.Cancel(); return Task.CompletedTask; },
            () => false,
            _ => { registrations++; return Task.CompletedTask; });
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => recovery.EnsureAsync(true, false, lifetime.Token));
        Assert.Equal(0, registrations);
    }
}

namespace Hopper.Core.Lifecycle;

/// <summary>
/// Runs every transaction cleanup even when an earlier cleanup fails.
/// </summary>
public sealed class CompositeAgentTransactionCleanup : IAgentTransactionCleanup
{
    private readonly IReadOnlyList<IAgentTransactionCleanup> _cleanups;

    public CompositeAgentTransactionCleanup(params IAgentTransactionCleanup[] cleanups)
    {
        ArgumentNullException.ThrowIfNull(cleanups);
        if (cleanups.Any(cleanup => cleanup is null))
            throw new ArgumentException("Transaction cleanups cannot contain null.", nameof(cleanups));
        _cleanups = cleanups.ToArray();
    }

    public void CleanupOpenTransactions()
    {
        List<Exception>? failures = null;
        foreach (var cleanup in _cleanups)
        {
            try
            {
                cleanup.CleanupOpenTransactions();
            }
            catch (Exception exception)
            {
                failures ??= new List<Exception>();
                failures.Add(exception);
            }
        }

        if (failures is { Count: > 0 })
            throw new AggregateException("One or more transaction cleanups failed.", failures);
    }
}

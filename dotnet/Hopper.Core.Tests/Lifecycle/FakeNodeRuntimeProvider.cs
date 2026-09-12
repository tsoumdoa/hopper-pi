namespace Hopper.Core.Tests.Lifecycle;

internal sealed class FakeNodeRuntimeProvider : INodeRuntimeProvider
{
    public List<string>? Calls { get; set; }
    public int ResolveCount { get; private set; }
    public TaskCompletionSource<NodeRuntimeResolution>? Gate { get; set; }
    public NodeRuntimeResolution Result { get; set; } = NodeRuntimeResolution.Success(
        new NodeRuntime(
            "/node",
            new NodeRuntimeVersion(22, 19, 0),
            NodeRuntimeSource.StandardPath));

    public Task<NodeRuntimeResolution> ResolveAsync(CancellationToken cancellationToken = default)
    {
        ResolveCount++;
        Calls?.Add("node.resolve");
        return Gate == null ? Task.FromResult(Result) : Gate.Task.WaitAsync(cancellationToken);
    }
}

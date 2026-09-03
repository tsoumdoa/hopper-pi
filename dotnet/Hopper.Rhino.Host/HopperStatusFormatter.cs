using Hopper.Core.Protocol;

namespace Hopper.Rhino.Host;

public static class HopperStatusFormatter
{
    public static IReadOnlyList<string> Format(RuntimeStatusV2 status)
    {
        ArgumentNullException.ThrowIfNull(status);

        return new[]
        {
            $"Hopper lifecycle: {status.Lifecycle.State}; reason: {Error(status.Lifecycle.Reason)}",
            $"Host: {status.Host.State}; PID: {Value(status.Host.ProcessId)}; handshake: {status.Host.Handshake}; health failures: {status.Host.HealthFailureCount}",
            $"Transport: {(status.Transport.Ready ? "ready" : "stopped")}; lifecycle instance: {Value(status.Transport.LifecycleInstanceId)}",
            $"Rhino document: {Document(status.Rhino)}",
            $"Grasshopper: {status.Grasshopper.State}; document: {Document(status.Grasshopper)}",
            $"Dispatcher: {(status.Dispatcher.AcceptingExternalWork ? "accepting" : "closed")}; depth: {status.Dispatcher.Depth}/{status.Dispatcher.Capacity}",
            $"Node: path={Value(status.Host.NodePath)}; version={Value(status.Host.NodeVersion)}",
            $"Latest errors: transport={Error(status.Errors.Transport)}; host={Error(status.Errors.Host)}; Rhino={Error(status.Errors.Rhino)}; Grasshopper={Error(status.Errors.Grasshopper)}; dispatcher={Error(status.Errors.Dispatcher)}",
        };
    }

    private static string Document(DocumentStatusV2 document) =>
        document.ActiveDocument ? document.DocumentName ?? "unnamed" : "none";

    private static string Document(GrasshopperStatusV2 document) =>
        document.ActiveDocument ? document.DocumentName ?? "unnamed" : "none";

    private static string Error(RuntimeErrorV2? error) =>
        error == null ? "none" : $"{error.Code}: {error.Message}";

    private static string Value(object? value) => value?.ToString() ?? "none";
}

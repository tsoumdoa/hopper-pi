#nullable enable

using System;
using System.Collections.Generic;
using Hopper.Core.Protocol;

namespace Hopper.Rhino.Host;

public static class HopperStatusFormatter
{
    public static IReadOnlyList<string> Format(RuntimeStatusV2 status, Uri? webUiAddress = null)
    {
        ArgumentNullException.ThrowIfNull(status);

        var lines = new List<string>
        {
            status.Lifecycle.State switch
            {
                LifecycleState.running => "HopperCode: connected",
                LifecycleState.starting => "HopperCode: connecting...",
                LifecycleState.stopping => "HopperCode: disconnecting...",
                LifecycleState.faulted => "HopperCode: connection failed. Run HopperCodeRestart to retry.",
                _ => "HopperCode: stopped. Run HopperCode to connect.",
            },
        };

        if (status.Lifecycle.State == LifecycleState.running)
            lines.Add(webUiAddress != null
                ? $"Web UI: {webUiAddress.GetLeftPart(UriPartial.Authority)}"
                : "Web UI: address unavailable. Run HopperCode to open it.");

        var errors = new HashSet<string>(StringComparer.Ordinal);
        AddError("Connection", status.Lifecycle.Reason);
        AddError("Connection", status.Errors.Transport);
        AddError("Host", status.Errors.Host);
        AddError("Rhino", status.Errors.Rhino);
        AddError("Grasshopper", status.Errors.Grasshopper);
        AddError("Request queue", status.Errors.Dispatcher);
        return lines;

        void AddError(string component, RuntimeErrorV2? error)
        {
            if (error == null) return;
            var message = SingleLine(error.Message);
            if (errors.Add(message))
                lines.Add($"{component} issue: {message}");
        }
    }

    private static string SingleLine(string value) =>
        string.Join(" ", value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
}

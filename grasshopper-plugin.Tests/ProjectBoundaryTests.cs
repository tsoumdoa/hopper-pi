using System.Xml.Linq;
using Xunit;

namespace rhino_zmq_poc.Tests;

public sealed class ProjectBoundaryTests
{
    [Fact]
    public void RhinoPluginProjectHasNoGrasshopperReference()
    {
        var project = LoadProject("grasshopper-plugin", "Hopper.Rhino", "Hopper.Rhino.csproj");
        var references = Includes(project, "ProjectReference")
            .Concat(Includes(project, "PackageReference"))
            .ToArray();

        Assert.DoesNotContain(references, reference =>
            reference.Contains("Grasshopper", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(references, reference =>
            reference.Contains("Hopper.Backend", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void CoreProjectHasNoRhinoOrGrasshopperReference()
    {
        var project = LoadProject("dotnet", "Hopper.Core", "Hopper.Core.csproj");
        var references = Includes(project, "ProjectReference")
            .Concat(Includes(project, "PackageReference"))
            .ToArray();

        Assert.DoesNotContain(references, reference =>
            reference.Contains("Rhino", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(references, reference =>
            reference.Contains("Grasshopper", StringComparison.OrdinalIgnoreCase));
    }

    private static XDocument LoadProject(params string[] segments)
    {
        var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../"));
        return XDocument.Load(Path.Combine(new[] { root }.Concat(segments).ToArray()));
    }

    private static IEnumerable<string> Includes(XDocument project, string itemName) =>
        project.Descendants(itemName)
            .Select(item => item.Attribute("Include")?.Value)
            .Where(value => value != null)!;
}

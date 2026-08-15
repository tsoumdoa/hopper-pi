using System.Text.Json;
using Grasshopper.Kernel;
using rhino_zmq_poc;
using Xunit;
using static Xunit.Skip;

namespace grasshopper_plugin.Tests;

public class ApplyGraphContractTests
{
    [Fact]
    public void Request_deserializes_tuple_endpoints_and_all_collections()
    {
        const string json = """
        {
          "components":[{"ref":"add","typeGuid":"11111111-1111-1111-1111-111111111111","x":100,"y":100}],
          "widgets":[{"ref":"slider","kind":"slider","x":100,"y":200,"min":0,"max":10,"value":2}],
          "scripts":[{"ref":"script","language":"python","x":300,"y":100,"code":"a = x"}],
          "wires":[{"from":["slider",0],"to":["add","A"]}],
          "groups":[{"name":"Graph","refs":["add","slider","script"]}]
        }
        """;

        var request = JsonSerializer.Deserialize<ApplyGraphRequest>(json);

        Assert.NotNull(request);
        Assert.Single(request.Components);
        Assert.Single(request.Widgets);
        Assert.Single(request.Scripts);
        Assert.Equal("slider", request.Wires[0].FromTuple[0].GetString());
        Assert.Equal("A", request.Wires[0].ToTuple[1].GetString());
        Assert.Equal(3, request.Groups[0].Refs.Count);
    }

    [Fact]
    public void Structural_validation_reports_duplicates_positions_and_dangling_refs()
    {
        const string json = """
        {
          "components":[
            {"ref":"dup","typeGuid":"11111111-1111-1111-1111-111111111111","x":10,"y":100}
          ],
          "widgets":[{"ref":"dup","kind":"toggle","x":100,"y":100,"value":true}],
          "wires":[{"from":["missing",0],"to":["dup",0]}],
          "groups":[{"name":"Graph","refs":["alsoMissing"]}]
        }
        """;
        var request = JsonSerializer.Deserialize<ApplyGraphRequest>(json)!;

        var codes = GraphOperations.Validate(request).Select(error => error.Code).ToList();

        Assert.Contains("INVALID_POSITION", codes);
        Assert.Contains("DUPLICATE_REF", codes);
        Assert.Contains("UNKNOWN_REF", codes);
    }

    [Fact]
    public void Structural_validation_accepts_port_names_and_zero_based_indexes()
    {
        const string json = """
        {
          "widgets":[
            {"ref":"source","kind":"slider","x":100,"y":100,"min":0,"max":10,"value":2},
            {"ref":"target","kind":"panel","x":300,"y":100,"text":""}
          ],
          "wires":[
            {"from":["source",0],"to":["target","Input"]}
          ]
        }
        """;
        var request = JsonSerializer.Deserialize<ApplyGraphRequest>(json)!;

        Assert.Empty(GraphOperations.Validate(request));
    }

    [SkippableFact]
    public void Invalid_port_after_creation_rolls_back_to_byte_equal_snapshot()
    {
        Skip.If(!GrasshopperRuntime.Available, "Requires loadable Grasshopper runtime assemblies.");
        Invalid_port_after_creation_rolls_back_to_byte_equal_snapshot_inner();
    }

    private static void Invalid_port_after_creation_rolls_back_to_byte_equal_snapshot_inner()
    {
        const string json = """
        {
          "widgets":[
            {"ref":"source","kind":"slider","x":100,"y":100,"min":0,"max":10,"value":2},
            {"ref":"target","kind":"panel","x":300,"y":100,"text":""}
          ],
          "wires":[{"from":["source",99],"to":["target",0]}]
        }
        """;
        var doc = new GH_Document();
        var before = DocumentSnapshots.Serialize(doc);
        var request = JsonSerializer.Deserialize<ApplyGraphRequest>(json)!;

        var result = GraphOperations.Apply(doc, request);
        var after = DocumentSnapshots.Serialize(doc);

        Assert.False(result.Ok);
        Assert.True(result.RolledBack);
        Assert.Empty(result.Refs);
        Assert.Equal(0, doc.ObjectCount);
        Assert.True(DocumentSnapshots.AreEqual(before, after));
    }

    [SkippableFact]
    public void Multi_wire_graph_runs_one_solution()
    {
        Skip.If(!GrasshopperRuntime.Available, "Requires loadable Grasshopper runtime assemblies.");
        Multi_wire_graph_runs_one_solution_inner();
    }

    private static void Multi_wire_graph_runs_one_solution_inner()
    {
        const string json = """
        {
          "widgets":[
            {"ref":"source","kind":"slider","x":100,"y":100,"min":0,"max":10,"value":2},
            {"ref":"first","kind":"panel","x":300,"y":100,"text":""},
            {"ref":"second","kind":"panel","x":300,"y":200,"text":""}
          ],
          "wires":[
            {"from":["source",0],"to":["first",0]},
            {"from":["source",0],"to":["second",0]}
          ]
        }
        """;
        var doc = new GH_Document();
        var solutionCount = 0;
        doc.SolutionStart += (_, _) => solutionCount++;
        var request = JsonSerializer.Deserialize<ApplyGraphRequest>(json)!;

        var result = GraphOperations.Apply(doc, request);

        Assert.True(result.Ok);
        Assert.Equal(2, result.Counts.Wires);
        Assert.Equal(1, solutionCount);
    }
}

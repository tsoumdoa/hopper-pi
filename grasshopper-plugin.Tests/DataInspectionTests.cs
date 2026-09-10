using System.Text;
using System.Text.Json;
using rhino_zmq_poc;
using Xunit;

namespace grasshopper_plugin.Tests;

public class DataInspectionTests
{
    private static InspectionRequest Request => new()
    {
        TargetId = "11111111-1111-1111-1111-111111111111", Mode = "items", BranchIndex = 0,
        DocumentRevision = "document-revision", TargetRevision = "target-revision",
    };

    [Fact]
    public void ByteLimitedPagesResumeWithoutSkippingRows()
    {
        var request = Request;
        var seen = new List<int>();
        do
        {
            var reads = 0;
            string json = DataInspectionPage.Build(request, 30, 20, new(), index =>
            {
                reads++;
                return new { index, value = new string('界', 256) };
            });
            Assert.True(Encoding.UTF8.GetByteCount(json) <= DataInspectionPage.MaxBytes);
            using var page = JsonDocument.Parse(json);
            var rows = page.RootElement.GetProperty("rows");
            Assert.InRange(rows.GetArrayLength(), 1, 19);
            Assert.InRange(reads, rows.GetArrayLength(), rows.GetArrayLength() + 1);
            seen.AddRange(rows.EnumerateArray().Select(row => row.GetProperty("index").GetInt32()));
            if (!page.RootElement.GetProperty("hasMore").GetBoolean()) break;
            request = DataInspectionPage.ReadCursor(page.RootElement.GetProperty("nextCursor").GetString()!);
        } while (true);
        Assert.Equal(Enumerable.Range(0, 30), seen);
    }

    [Fact]
    public void DirectOffsetsAndEmptyPagesDoNotScanEarlierData()
    {
        var visited = new List<int>();
        var json = DataInspectionPage.Build(Request with { Offset = 80000 }, 150000, 2, new(), index => { visited.Add(index); return index; });
        Assert.Equal(new[] { 80000, 80001 }, visited);
        using var page = JsonDocument.Parse(json);
        Assert.Equal(80002, DataInspectionPage.ReadCursor(page.RootElement.GetProperty("nextCursor").GetString()!).Offset);
        using var empty = JsonDocument.Parse(DataInspectionPage.Build(Request, 0, 20, new(), _ => throw new Exception("Must not read empty data")));
        Assert.False(empty.RootElement.GetProperty("hasMore").GetBoolean());
        Assert.Equal(JsonValueKind.Null, empty.RootElement.GetProperty("nextCursor").ValueKind);
    }

    [Fact]
    public void CursorsRejectChangedDocumentOrTarget()
    {
        var request = DataInspectionPage.ReadCursor(DataInspectionPage.Cursor(Request));
        DataInspectionPage.ValidateRevision(request, "document-revision", "target-revision");
        Assert.Throws<InvalidOperationException>(() => DataInspectionPage.ValidateRevision(request, "new-document", "target-revision"));
        Assert.Throws<InvalidOperationException>(() => DataInspectionPage.ValidateRevision(request, "document-revision", "new-solution"));
        Assert.Throws<ArgumentException>(() => DataInspectionPage.ReadCursor("broken"));
    }
}

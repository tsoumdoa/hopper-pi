using Hopper.Core.Runtime;
using Xunit;

namespace Hopper.Core.Tests;

public sealed class BrowserOpenRequestTests
{
    [Fact]
    public void MultipleRhinosReattachWithoutReplacingTheExistingBrowser()
    {
        var uri = new Uri("http://127.0.0.1:54321/#credential");
        var requests = new[] { new BrowserOpenRequest(), new BrowserOpenRequest() };
        foreach (var request in requests)
        {
            request.Request();
            Assert.False(request.Take(false, uri)); // Registration precedes lifecycle readiness.
            Assert.True(request.Take(true, uri));
        }
        for (var restart = 0; restart < 3; restart++)
            foreach (var request in requests)
                Assert.False(request.Take(true, uri));

        requests[1].Request(); // Explicit HopperCode still opens the stable host URL.
        Assert.True(requests[1].Take(true, uri));
        Assert.False(requests[1].Take(true, uri));
        Assert.False(requests[0].Take(true, uri));
    }

    [Fact]
    public void ExplicitOpenWaitsForReadinessAndIsConsumedOnce()
    {
        var request = new BrowserOpenRequest();
        var uri = new Uri("http://127.0.0.1:54321/");
        Assert.False(request.Take(true, uri));
        request.Request();
        Assert.False(request.Take(true, null));
        Assert.True(request.Take(true, uri));
        Assert.False(request.Take(true, uri));
    }
}

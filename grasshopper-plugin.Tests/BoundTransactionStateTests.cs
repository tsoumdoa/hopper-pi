using System.Runtime.Versioning;
using Xunit;

namespace rhino_zmq_poc.Tests;

[SupportedOSPlatform("windows7.0")]
public sealed class BoundTransactionStateTests
{
    [Fact]
    public void CleanupUsesDocumentThatOpenedTransactionAfterActiveDocumentSwitches()
    {
        var state = new BoundTransactionState<object, object>();
        var originalDocument = new object();
        var newActiveDocument = new object();
        var snapshot = new object();
        state.Begin(originalDocument, snapshot);

        object? cleanedDocument = null;
        object? cleanedSnapshot = null;
        state.Complete((document, savedSnapshot) =>
        {
            cleanedDocument = document;
            cleanedSnapshot = savedSnapshot;
            return true;
        });

        Assert.Same(originalDocument, cleanedDocument);
        Assert.NotSame(newActiveDocument, cleanedDocument);
        Assert.Same(snapshot, cleanedSnapshot);
        Assert.False(state.IsActive);
    }

    [Fact]
    public void CleanupUsesDocumentThatOpenedTransactionAfterActiveDocumentCloses()
    {
        var state = new BoundTransactionState<object, object>();
        var closedDocument = new object();
        state.Begin(closedDocument, new object());

        object? activeDocument = null;
        var cleanedDocument = state.Complete((document, _) => document);

        Assert.Null(activeDocument);
        Assert.Same(closedDocument, cleanedDocument);
        Assert.False(state.IsActive);
    }

    [Fact]
    public void FailedCleanupClearsStateAndDoesNotBlockLaterCleanup()
    {
        var state = new BoundTransactionState<object, object>();
        state.Begin(new object(), new object());

        Assert.Throws<InvalidOperationException>(() =>
            state.Complete<bool>((_, _) => throw new InvalidOperationException("restore failed")));
        Assert.False(state.IsActive);

        var nextDocument = new object();
        state.Begin(nextDocument, new object());

        Assert.Same(nextDocument, state.Complete((document, _) => document));
        Assert.False(state.IsActive);
    }
}

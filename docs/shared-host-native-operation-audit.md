# Shared native operation routing audit

The shared transport is enabled by `HOPPER_SHARED_HOST=1` or authenticated `HopperBootstrap`. Owned-child envelopes remain available and cannot carry a shared execution owner. Native builds and deterministic transport tests verify the checks below. Packaged Rhino focus, document-window and transfer fidelity tests remain separate acceptance evidence.

## Dispatch and attachment checks

An authenticated handshake includes the host epoch. The native lifecycle validates the epoch and PID against current private discovery, binds the actual DEALER route and issues an attachment generation. Repeated handshakes from the same epoch and route retain the generation. Reattachment retires the old route/epoch, fences its queued requests and queues recovery ahead of ordinary UI work. Running native work finishes before the UI queue reaches recovery. RPC servicing stays available during that work.

Both admission and the UI queue head verify the route, lifecycle, generation and operation binding. The queue head checks captured native document identities. Process transaction scopes retain task, turn, binding and attachment identity. A different owner cannot use or close either scope. Begin reserves ownership before native invocation, so a partially failed begin cannot admit a different task.

Recovery receives the recorded owners for both scopes. An active native scope with missing or conflicting document ownership blocks recovery. Confirmed cleanup clears both bookkeeping scopes and document transaction status. Failed cleanup leaves geometry admission blocked. Recovery does not assert that closing a Rhino undo record rolled back an edit.

Scope completion is the one document-focus exception. It requires the exact owner that opened the scope and calls the native bound-document completion routines. This permits cleanup after focus or association changes without routing a new edit to the current document.

## Exposed operation requirements

| Operations | Native requirement |
| --- | --- |
| `lifecycleHandshake`, `getRuntimeStatus`, `getOperationResult`, `cancelOperation`, `startGrasshopper`, `listAllComponents`, `listRhinoDocuments`, `listGrasshopperDocuments`, `browseDocumentFiles` | Current authenticated lifecycle route. These inspect lifecycle metadata, recover retained results or use the explicit lifecycle controls. They do not acquire a document binding implicitly. |
| `getDocumentTransactionState` | Current authenticated route permits ownerless recovery reads of both scope kinds. An owner-bearing read may inspect only its selected kind or captured associated Rhino kind. |
| `getRhinoDocument`, `getRhinoDocumentSettings`, `queryRhinoObjects`, `captureRhinoView`, `controlRhinoView`, `runRhinoScript`, `beginRhinoAgentTransaction`, `exportRhinoArtifact`, `importRhinoArtifact` | Captured Rhino identity must still equal the native active document. A Grasshopper binding may authorize its explicitly captured associated Rhino identity. Conflicting `documentId`, `expectedDocument` or lifecycle arguments fail. |
| `getGrasshopperDocument`, `getCurrentCanvas`, `getCanvasErrors`, `listScriptParams`, `getScriptCode` | Captured canvas identity and association must still match. If a Rhino association was captured, it must still be the active Rhino context. |
| `getGrasshopperDocumentSettings`, `getParamRhinoGeometry`, `setParamRhinoGeometry` | Captured Grasshopper and Rhino pair, unchanged association, matching active canvas and active Rhino context. |
| `applyGraph`, component/wire/group edits, slider/panel/toggle/swatch/scribble/value-list edits, script-node/parameter edits, `beginAgentTransaction` | Same captured canvas and association checks. Mutations without an associated Rhino document remain unavailable because Grasshopper evaluation may read active Rhino settings. |
| `commitAgentTransaction`, `cancelAgentTransaction`, `commitRhinoAgentTransaction`, `cancelRhinoAgentTransaction` | Exact recorded scope owner. Completion uses the document reference retained when opening the scope, even after focus changes. |
| `manageRhinoDocument`, `manageGrasshopperDocument` | New/open require separate `documentActionOwner`, current lifecycle/generation, both scopes closed, recovery complete, and at most one wire operation ID per grant. Bound save/saveAs/close accept the captured execution owner, enforce document identity/state tokens, close only that owner’s recorded segment, and require the other native scope idle. Captured activation requires both scopes idle, observed current active identity and target state token, validates the requested document against the owner, and verifies the active target afterward. Host-reserved canonical destinations, content digests, and native transition preconditions protect managed writes. |

All component, wire, group, value and script operations retain the current executor routing through the native active canvas. The shared guard checks that canvas immediately before invocation instead of switching to another canvas. On Mac, New/Open creates another document window in the same process. A new window remains under the same process queue; it does not provide concurrent native editing.

Before starting geometry or transferring an artifact, the host can activate the captured document under its process lease after confirming both native scopes idle. It records the activation intent, supplies observed state/current-focus tokens, and verifies the selected context afterward. Later active-document drift fails at native dispatch. Switching browser selection cannot change a running owner.

## Script and transfer limits

Rhino scripts receive the validated active Rhino document as their default context. Grasshopper scripts execute in the validated canvas and associated Rhino context. These are trusted in-process programs; they can access other documents and external files through native APIs. RPC binding and managed-save reservations do not sandbox arbitrary script side effects.

Export supports unmaterialed points, point clouds, curves, surfaces, breps, extrusions and meshes. Instances, annotation/font dependencies, lights, plugin geometry and assigned materials fail before export. Export writes a new `.3dm` staging file and never changes the source document save path. The manifest data includes units, absolute tolerance, supported object types, selected source identities, byte length and creation time.

The packaged Mac fixture exposed a RhinoCommon collection bug: `File3dmObjectTable.Count` reported one object while LINQ `ToArray()` returned a null entry. Import now enumerates the native table explicitly and rejects missing geometry or attributes before mutation.

Import hashes the actual byte buffer passed to `File3dm.FromByteArray`, checks source units and destination settings revision, and validates all geometry before changing the destination. Standard units must use the native physical conversion factor. Unknown/custom units need an explicitly supplied factor. Import requires the owner's Rhino scope, creates a unique transfer layer namespace and new destination object identities, and returns source/destination provenance. A partial add reports the IDs already added rather than claiming atomic rollback. Native round-trip fidelity is not established by compiling this adapter.

## Deterministic verification

`SharedExecutionFenceTests` covers stable and retired attachments, queued stale owners, recovery failure, scope ownership across tasks, active-document revalidation and transport responsiveness during running native work. `RpcTransportOwnerTests.SharedReattachmentFencesQueuedMutationOnTheUiQueue` uses actual NetMQ routes and verifies that a fenced queued mutation gets a retained failed result without invoking the native handler. Shared and owned-child request schemas are checked in TypeScript, C# and the JSON schema.

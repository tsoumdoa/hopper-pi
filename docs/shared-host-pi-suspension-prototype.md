# Pi question suspension prototype

The shipped `@earendil-works/pi-coding-agent` 0.85.1 and its `pi-agent-core` 0.85.1 dependency support the model/tool stopping boundary required by milestone 1. The prototype is in `src/host/question-suspension.ts`; it is not connected to the owned-child host or browser question handler.

Install the boundary on `session.agent` after AgentSession construction and before prompting. It preserves the existing tool authorization hook, selects sequential tool execution, blocks remaining calls after a question, and uses `shouldStopAfterTurn` to end the run. The task's question tool calls `suspend` with its stable question, task, session, turn, and Pi tool-call identities. An injected persistence function must commit the question before the tool returns `awaiting_user`. A failed commit still stops dispatch and leaves an error tool result. The scheduler must interpret that failure and retain ownership until it has resolved cleanup.

The SDK's blocked-tool path produces an error result for every remaining valid sibling call. Unknown tools or invalid arguments also produce error results without dispatch. The stop hook prevents the next provider request even if earlier successful edits mean the whole tool batch did not terminate. `abort()` alone is unsuitable for this protocol: the SDK sequential loop breaks after an aborted call and can leave later calls without tool-result messages. Returning `terminate: true` from the question alone is also insufficient: the SDK terminates a batch only when every result requests termination, and does not use that flag to skip siblings.

## Checked behavior

`pnpm exec vitest run src/host/question-suspension.test.ts` exercises the actual installed AgentSession and agent loop with an injected provider stream. It uses a temporary on-disk SessionManager and makes no external model request.

- A batch containing an edit, a question, and another edit dispatches only the first edit. The question commits once, its history result remains `awaiting_user`, and the last edit has a not-executed error result. Exactly one provider call occurs.
- After the first run settles, a separate prompt supplies explicit question/old-turn/new-turn identities and the answer. Reopening the session file retains the original question result and exactly one answer message.
- A failed question commit blocks the last edit and the next provider call.
- A pending commit keeps Pi running and prevents removal of the boundary. Steering and follow-ups queued during persistence are not consumed by the suspended execution.

Source evidence is in the installed package files `pi-agent-core/dist/agent-loop.js`, specifically `executeToolCallsSequential`, `prepareToolCall`, `shouldTerminateToolBatch`, and the `shouldStopAfterTurn` check in `runLoop`. `pi-agent-core/dist/agent.js` captures the stop callback when the run starts, so installing it after prompting is too late. `pi-coding-agent/dist/core/agent-session.js` installs extension tool hooks during session construction; install this boundary afterward so those hooks remain chained.

## Remaining integration work

This proves the SDK stopping and history behavior, not milestone 1 completion or the shared question workflow. The shared scheduler and journal must still implement question/answer transactions, native-operation settlement, scope cleanup, process ownership, cancellation races, model-start intent, crash recovery, and answer-linked turn deduplication. The test's explicit answer prompt is not an implementation of durable answer admission.

Do not enable answers or release a Rhino process merely because Pi stopped. Resolve actual native effects and close the owned scopes first. A question commit alone does not establish an answerable question. During recovery, reconstruct question state from the journal and reconcile history without rewriting the old tool result as an answer.

One boundary belongs to one execution. Remove it only after Pi settles, and install a new boundary before a newly admitted execution. The scheduler must keep ownership of these hooks and sequential execution mode throughout the run. No extension may replace them. Pending Pi steering/follow-up queues remain in memory when the stop hook ends a run; shared mode must use journaled admission and explicitly settle or clear old queues before starting another execution. This prototype neither consumes those commands nor silently carries them into a continuation.

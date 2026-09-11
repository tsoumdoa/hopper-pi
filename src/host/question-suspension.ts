import type { AgentSession, AgentToolResult } from "@earendil-works/pi-coding-agent";

type PiAgent = AgentSession["agent"];

export type SuspendedQuestion = {
	questionId: string;
	taskId: string;
	turnId: string;
	sessionId: string;
	toolCallId: string;
	question: string;
};

/**
 * One execution's Pi boundary. Install after AgentSession installs its tool hooks,
 * before prompting. The scheduler owns persistence, native cleanup and admission
 * of a fresh answer-linked turn. This adapter never accepts a browser answer.
 */
export class QuestionSuspensionBoundary {
	private stopping = false;
	private installed = true;
	private readonly previousBefore: PiAgent["beforeToolCall"];
	private readonly previousStop: PiAgent["shouldStopAfterTurn"];
	private readonly previousExecution: PiAgent["toolExecution"];
	private readonly before: NonNullable<PiAgent["beforeToolCall"]>;
	private readonly stop: NonNullable<PiAgent["shouldStopAfterTurn"]>;

	constructor(
		private readonly agent: PiAgent,
		private readonly persistQuestion: (question: SuspendedQuestion) => Promise<void | string>,
	) {
		if (agent.state.isStreaming) throw new Error("Install question suspension before starting Pi");
		this.previousBefore = agent.beforeToolCall;
		this.previousStop = agent.shouldStopAfterTurn;
		this.previousExecution = agent.toolExecution;
		this.before = async (context, signal) => {
			if (this.stopping) return { block: true, reason: "Not executed: this turn is suspended for a user question." };
			return this.previousBefore?.(context, signal);
		};
		this.stop = async (context, signal) => this.stopping || (await this.previousStop?.(context, signal)) === true;
		agent.toolExecution = "sequential";
		agent.beforeToolCall = this.before;
		agent.shouldStopAfterTurn = this.stop;
	}

	/** Called by the task's ask_user tool; persistence failure also stops dispatch. */
	async suspend(question: SuspendedQuestion, status: "awaiting_user" | "document_handoff" = "awaiting_user"): Promise<AgentToolResult<{ status: "awaiting_user" | "document_handoff"; question: SuspendedQuestion }>> {
		if (!this.installed || this.stopping) throw new Error("Question suspension is no longer accepting questions");
		this.stopping = true;
		const captured = { ...question };
		const persistedId = await this.persistQuestion({ ...captured });
		if (typeof persistedId === "string") captured.questionId = persistedId;
		return {
			content: [{ type: "text", text: JSON.stringify({ status, questionId: captured.questionId }) }],
			details: { status, question: captured },
		};
	}

	/** Call only after Pi settles. This does not establish native cleanup or release ownership. */
	dispose(): void {
		if (!this.installed) return;
		if (this.agent.state.isStreaming) throw new Error("Cannot remove question suspension while Pi is running");
		if (this.agent.beforeToolCall !== this.before || this.agent.shouldStopAfterTurn !== this.stop) {
			throw new Error("Pi question suspension hooks were replaced");
		}
		this.agent.beforeToolCall = this.previousBefore;
		this.agent.shouldStopAfterTurn = this.previousStop;
		this.agent.toolExecution = this.previousExecution;
		this.installed = false;
	}
}

export type WireMessage = Record<string, unknown>;
type SnapshotMessage = { type: "snapshot"; snapshot: Record<string, unknown> };

export const mockRuntimeStatus: Record<string, unknown> = {
	revision: 42,
	lifecycle: { state: "running", reason: null },
	transport: { ready: true, lifecycleInstanceId: "mock-rhino-instance" },
	host: { state: "running", processId: 5124, nodeVersion: "22.19.0", handshake: "live", healthFailureCount: 0 },
	rhino: { activeDocument: true, documentName: "atrium-study.3dm" },
	grasshopper: { state: "ready", activeDocument: true, documentName: "atrium-grid.gh" },
	dispatcher: { depth: 0, capacity: 64, acceptingExternalWork: true },
	errors: { transport: null, host: null, rhino: null, grasshopper: null, dispatcher: null },
};

function snapshot(overrides: Record<string, unknown> = {}): SnapshotMessage {
	return {
		type: "snapshot",
		snapshot: {
			sessionId: "mock-session",
			sessionName: "Atrium facade study",
			isStreaming: false,
			thinkingLevel: "medium",
			availableThinkingLevels: ["off", "low", "medium", "high"],
			model: { provider: "openai", id: "gpt-5.6", name: "GPT-5.6" },
			models: [
				{ provider: "openai", id: "gpt-5.6", name: "GPT-5.6" },
				{ provider: "anthropic", id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
			],
			providers: [
				{ id: "openai", name: "OpenAI", authenticated: true },
				{ id: "anthropic", name: "Anthropic", authenticated: false },
			],
			messages: [
				{ id: "mock-user-1", role: "user", content: "Inspect the active Grasshopper canvas and summarize its structure." },
				{
					id: "mock-assistant-1", role: "assistant", content: [
						{ type: "text", text: "The definition builds a radial facade panel system around a single base profile." },
						{ type: "toolCall", id: "mock-tool-1", name: "gh_list_components", arguments: { search: "panel" } },
					],
				},
				{ id: "mock-tool-1", role: "toolResult", toolCallId: "mock-tool-1", content: "Found 12 components. Two have runtime warnings.", isError: false },
			],
			...overrides,
		},
	};
}

export class MockHopperTransport {
	private timers = new Set<number>();
	private stopped = false;

	constructor(private readonly emit: (message: WireMessage) => void) {}

	connect() {
		this.schedule(80, () => this.emit(snapshot()));
		this.schedule(110, () => this.emit({ type: "ui_notification", message: "Mock mode is active. Rhino and provider accounts are never contacted.", level: "info" }));
	}

	close() {
		this.stopped = true;
		for (const timer of this.timers) window.clearTimeout(timer);
		this.timers.clear();
	}

	send(message: WireMessage) {
		switch (message.type) {
			case "authenticate": this.connect(); break;
			case "prompt": this.runPrompt(String(message.text ?? "")); break;
			case "steer": this.emit({ type: "ui_notification", message: "Mock agent received your steering note.", level: "info" }); break;
			case "follow_up": this.emit({ type: "ui_notification", message: "Mock follow-up queued for the next turn.", level: "info" }); break;
			case "abort": this.emit({ type: "agent_event", event: { type: "agent_end" } }); break;
			case "new_session": this.emit({ type: "session_replaced", session: snapshot({ sessionId: "mock-session-new", sessionName: "New mock session", messages: [] }).snapshot }); break;
			case "set_model": this.emit(snapshot({ model: { provider: message.provider, id: message.id, name: String(message.id) } })); break;
			case "set_thinking": this.emit(snapshot({ thinkingLevel: message.level })); break;
			case "login": this.emit({ type: "auth_event", event: message.authType === "oauth" ? { type: "auth_url", instructions: "Mock OAuth flow. No account will be opened.", url: "https://example.com/mock-auth" } : { type: "info", message: "Mock API key accepted." } }); this.schedule(250, () => this.emit(snapshot())); break;
			case "logout": this.emit({ type: "status", status: "logged_out", scope: "auth", provider: message.provider }); break;
			case "ui_response":
				this.emit({ type: "ui_notification", message: message.value === null || message.value === false ? "Mock request cancelled." : `Mock response recorded: ${String(message.value).slice(0, 60)}`, level: "info" });
				this.schedule(200, () => this.emit({ type: "agent_event", event: { type: "agent_end" } }));
				break;
			case "mock_scenario": this.runScenario(String(message.scenario)); break;
		}
	}

	private runPrompt(prompt: string) {
		const scenario = prompt.trim().match(/^\/mock\s+(option|confirm|editor|failure)$/i)?.[1]?.toLowerCase();
		if (scenario) {
			this.runScenario(scenario === "option" ? "pick_option" : scenario === "failure" ? "tool_error" : scenario);
			return;
		}
		const messageId = `mock-assistant-${Date.now()}`;
		const toolId = `mock-tool-${Date.now()}`;
		this.emit({ type: "agent_event", event: { type: "agent_start" } });
		this.schedule(120, () => this.emit({ type: "agent_event", event: { type: "message_start", message: { id: messageId, role: "assistant" } } }));
		this.schedule(260, () => this.emit({ type: "agent_event", event: { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "I will check the active document first, then make the smallest safe edit. " } } }));
		this.schedule(500, () => this.emit({ type: "agent_event", event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `I’m testing the interface with your request: “${prompt}”. ` } } }));
		this.schedule(760, () => this.emit({ type: "agent_event", event: { type: "tool_execution_start", toolCallId: toolId, toolName: "gh_list_components", args: { search: "panel" } } }));
		this.schedule(1_150, () => this.emit({ type: "agent_event", event: { type: "tool_execution_end", toolCallId: toolId, result: "Found 12 panel-related components and two warnings.", isError: false } }));
		this.schedule(1_400, () => this.emit({ type: "agent_event", event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "The mock run is complete. No Rhino document changed." } } }));
		this.schedule(1_600, () => this.emit({ type: "agent_event", event: { type: "agent_end" } }));
	}

	private runScenario(scenario: string) {
		this.emit({ type: "agent_event", event: { type: "agent_start" } });
		this.emit({ type: "ui_status", key: "working", text: scenario === "tool_error" ? "Applying graph" : "Waiting for your answer" });
		if (scenario === "pick_option") this.emit({ type: "ui_request", requestId: `mock-choice-${Date.now()}`, kind: "select", title: "Choose a panel strategy", description: "This is a mock agent question.", options: [{ id: "uniform", value: "uniform", label: "Uniform panels", description: "Keep the current rhythm." }, { id: "gradient", value: "gradient", label: "Gradient panels", description: "Increase density near the entry." }] });
		if (scenario === "confirm") this.emit({ type: "ui_request", requestId: `mock-confirm-${Date.now()}`, kind: "confirm", title: "Apply the mock change?", description: "No Rhino document will change." });
		if (scenario === "editor") this.emit({ type: "ui_request", requestId: `mock-editor-${Date.now()}`, kind: "editor", title: "Edit a mock script", prefill: "// This is a local mock editor\nreturn panels;" });
		if (scenario === "tool_error") {
			const toolId = `mock-failed-tool-${Date.now()}`;
			this.emit({ type: "agent_event", event: { type: "message_start", message: { id: `mock-error-${Date.now()}`, role: "assistant" } } });
			this.emit({ type: "agent_event", event: { type: "tool_execution_start", toolCallId: toolId, toolName: "gh_apply_graph", args: { components: 4 } } });
			this.schedule(400, () => this.emit({ type: "agent_event", event: { type: "tool_execution_end", toolCallId: toolId, result: "Mock validation error: one input endpoint is missing.", isError: true } }));
			this.schedule(600, () => this.emit({ type: "agent_event", event: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "The graph could not be applied because one input endpoint is missing. I can retry after wiring it." } } }));
			this.schedule(800, () => this.emit({ type: "agent_event", event: { type: "agent_end" } }));
		}
	}

	private schedule(delay: number, callback: () => void) {
		const timer = window.setTimeout(() => {
			this.timers.delete(timer);
			if (!this.stopped) callback();
		}, delay);
		this.timers.add(timer);
	}
}

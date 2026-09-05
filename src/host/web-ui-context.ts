import { randomUUID } from "node:crypto";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import type {
	ExtensionUIDialogOptions,
	ExtensionUIContext,
	ExtensionWidgetOptions,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { HostMessageBus } from "./message-bus.js";
import type { UiRequestMessage } from "./protocol.js";
import { toWireValue } from "./event-serializer.js";

type UiResponse = string | boolean | null;

type PendingRequest = {
	message: UiRequestMessage;
	resolve: (value: UiResponse) => void;
	reject: (error: Error) => void;
	removeAbort?: () => void;
};

const plainTheme = new Proxy({}, {
	get: (_target, property) => {
		if (property === "name") return "hopper-web";
		if (property === "fg" || property === "bg") return (_color: string, text: string) => text;
		if (["bold", "italic", "underline", "inverse", "strikethrough"].includes(String(property))) {
			return (text: string) => text;
		}
		return undefined;
	},
}) as Theme;

export class BrowserUiContext {
	readonly context: ExtensionUIContext;
	private readonly pending = new Map<string, PendingRequest>();
	private editorText = "";

	constructor(private readonly bus: HostMessageBus) {
		this.context = this.createContext();
	}

	respond(requestId: string, value: UiResponse): boolean {
		const pending = this.pending.get(requestId);
		if (!pending) return false;
		this.pending.delete(requestId);
		pending.removeAbort?.();
		pending.resolve(value);
		return true;
	}

	replayPending(): void {
		for (const pending of this.pending.values()) this.bus.publish(pending.message);
	}

	cancelAll(reason = "UI closed"): void {
		for (const pending of this.pending.values()) {
			pending.removeAbort?.();
			pending.reject(new Error(reason));
		}
		this.pending.clear();
	}

	requestAuthPrompt(prompt: AuthPrompt): Promise<string> {
		const options = prompt.type === "select"
			? prompt.options.map((option) => ({ ...option, value: option.id }))
			: undefined;
		return this.request({
			kind: prompt.type === "select" ? "select" : "input",
			title: prompt.message,
			options,
			placeholder: "placeholder" in prompt ? prompt.placeholder : undefined,
			secret: prompt.type === "secret",
		}, prompt.signal).then((value) => {
			if (typeof value !== "string") throw new Error("Authentication was cancelled");
			return value;
		});
	}

	notifyAuth(event: AuthEvent): void {
		this.bus.publish({ type: "auth_event", event: toWireValue(event) });
	}

	private request(
		input: Omit<UiRequestMessage, "type" | "requestId">,
		signal?: AbortSignal,
	): Promise<UiResponse> {
		if (signal?.aborted) return Promise.reject(new Error("UI request aborted"));

		const requestId = randomUUID();
		const message: UiRequestMessage = { type: "ui_request", requestId, ...input };
		return new Promise<UiResponse>((resolve, reject) => {
			const pending: PendingRequest = { message, resolve, reject };
			if (signal) {
				const onAbort = () => {
					this.pending.delete(requestId);
				reject(new Error("UI request aborted"));
			};
			signal.addEventListener("abort", onAbort, { once: true });
			pending.removeAbort = () => signal.removeEventListener("abort", onAbort);
			}
			this.pending.set(requestId, pending);
			this.bus.publish(message);
		});
	}

	private createContext(): ExtensionUIContext {
		return {
			select: async (title: string, options: string[], dialog?: ExtensionUIDialogOptions) => {
				const value = await this.request({
					kind: "select",
					title,
					options: options.map((option) => ({ id: option, value: option, label: option })),
				}, dialog?.signal);
				return typeof value === "string" ? value : undefined;
			},
			confirm: async (title: string, message: string, dialog?: ExtensionUIDialogOptions) => {
				const value = await this.request({ kind: "confirm", title, description: message }, dialog?.signal);
				return value === true;
			},
			input: async (title: string, placeholder?: string, dialog?: ExtensionUIDialogOptions) => {
				const value = await this.request({ kind: "input", title, placeholder }, dialog?.signal);
				return typeof value === "string" ? value : undefined;
			},
			notify: (message, level = "info") => this.bus.publish({ type: "ui_notification", message, level }),
			onTerminalInput: () => () => {},
			setStatus: (key, text) => this.bus.publish({ type: "ui_status", key, text }),
			setWorkingMessage: (message) => this.bus.publish({ type: "ui_status", key: "working", text: message }),
			setWorkingVisible: () => {},
			setWorkingIndicator: () => {},
			setHiddenThinkingLabel: () => {},
			setWidget: (key: string, content: unknown, options?: ExtensionWidgetOptions) => {
				this.bus.publish({
					type: "ui_widget",
					key,
					lines: Array.isArray(content) && content.every((line) => typeof line === "string") ? content : undefined,
					placement: options?.placement,
				});
			},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: (title) => this.bus.publish({ type: "ui_status", key: "title", text: title }),
			custom: async () => { throw new Error("Custom terminal UI is unavailable in the browser host"); },
			pasteToEditor: (text) => { this.editorText += text; },
			setEditorText: (text) => { this.editorText = text; },
			getEditorText: () => this.editorText,
			editor: async (title, prefill) => {
				const value = await this.request({ kind: "editor", title, prefill });
				return typeof value === "string" ? value : undefined;
			},
			addAutocompleteProvider: () => {},
			setEditorComponent: () => {},
			getEditorComponent: () => undefined,
			theme: plainTheme,
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false, error: "Themes are controlled by the web UI" }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		};
	}
}

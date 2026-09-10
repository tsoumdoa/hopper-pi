// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./app";
import { createHopperStore } from "./state/hopper-store";
import type { HopperStore } from "./state/hopper-types";
import { HopperStoreProvider } from "./state/hopper-store-context";
import type { PromptReceipt } from "./hooks/use-hopper-connection";
import type { DraftImage } from "./lib/image-attachments";

const { prompt } = vi.hoisted(() => ({ prompt: vi.fn<(...args: unknown[]) => boolean>(() => true) }));

vi.mock("./hooks/use-hopper-connection", () => ({
	useHopperConnection: () => {
		return { token: "test", send: () => true, prompt, login: () => true, logout: () => true, reconnect: () => {}, isMockMode: false };
	},
}));
vi.mock("./hooks/use-runtime-status", () => ({ useRuntimeStatus: () => ({ refresh: async () => {}, refreshing: false }) }));
vi.mock("./lib/image-attachments", async (load) => ({
	...await load<typeof import("./lib/image-attachments")>(),
	readImage: async () => ({ id: "draft-image", name: "plan.png", width: 800, height: 500,
		image: { type: "image", mimeType: "image/png", data: "bWFya2Vk" },
		original: { type: "image", mimeType: "image/png", data: "cGxhbg==" },
		scene: { elements: [], files: {}, appState: { currentItemStrokeColor: "red" } },
	}),
}));
vi.mock("./components/image-annotation-dialog", () => ({
	ImageAnnotationDialog: ({ attachment }: { attachment: DraftImage }) => createElement("div", { role: "dialog" },
		attachment.scene?.appState.currentItemStrokeColor === "red" ? "Editable annotations restored" : "Missing annotations"),
}));

let root: Root;
let container: HTMLDivElement;
let store: HopperStore;
beforeEach(async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	store = createHopperStore();
	store.getState().actions.applySnapshot({
		sessionId: "session-1", messages: [], isStreaming: true, thinkingLevel: "off", availableThinkingLevels: ["off"],
		models: [{ provider: "openai", id: "test-model", name: "Test model" }], model: { provider: "openai", id: "test-model" },
		providers: [{ id: "openai", name: "OpenAI", authenticated: true, authMethods: [{ type: "api_key", label: "API key" }] }],
		streamingMessage: { id: "assistant-1", role: "assistant", content: [{ type: "text", text: "Checking " }] },
	});
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	await act(async () => root.render(createElement(HopperStoreProvider, { store, children: createElement(App) })));
	vi.clearAllMocks();
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

async function submitAnnotatedDraft() {
	const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
	Object.defineProperty(input, "files", { value: [new File(["image"], "plan.png", { type: "image/png" })] });
	await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
	await act(async () => {
		const textarea = container.querySelector("textarea")!;
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "Inspect the marked area");
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
	});
	await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click());
	return prompt.mock.calls.at(-1)![3] as PromptReceipt;
}

it("retains text and editable annotations after a rejected submission and snapshot", async () => {
	const receipt = await submitAnnotatedDraft();
	expect(container.querySelector("textarea")!.disabled).toBe(true);
	expect(container.querySelector("img")!.src).toContain("bWFya2Vk");
	await act(async () => {
		receipt.onRejected();
		store.getState().actions.applySnapshot({ sessionId: "session-1", messages: [], isStreaming: false,
			thinkingLevel: "off", availableThinkingLevels: [], models: [], providers: [] });
	});
	expect(container.querySelector("textarea")!.value).toBe("Inspect the marked area");
	expect(container.querySelector("textarea")!.disabled).toBe(false);
	await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Annotate plan.png"]')!.click());
	expect(container.textContent).toContain("Editable annotations restored");
});

it("clears a draft only after acceptance and ignores late receipts from previous submissions", async () => {
	const first = await submitAnnotatedDraft();
	await act(async () => first.onRejected());
	await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Send message"]')!.click());
	const second = prompt.mock.calls.at(-1)![3] as PromptReceipt;
	await act(async () => first.onAccepted());
	expect(container.querySelector("img")).not.toBeNull();
	await act(async () => second.onAccepted());
	expect(container.querySelector("img")).toBeNull();
	expect(container.querySelector("textarea")!.value).toBe("");
});

it("downloads the full session through the authenticated export endpoint", async () => {
	let finish!: (response: Response) => void;
	const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
	vi.stubGlobal("fetch", fetchMock);
	const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:session-export");
	const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
		expect(this.download).toBe("hopper-session-debug.json");
		expect(this.href).toBe("blob:session-export");
	});
	try {
		const button = container.querySelector<HTMLButtonElement>('button[aria-label="Export session"]')!;
		await act(async () => button.click());
		expect(button.disabled).toBe(true);
		expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/session/export", { headers: { Authorization: "Bearer test" } });
		await act(async () => button.click());
		expect(fetchMock).toHaveBeenCalledOnce();
		vi.useFakeTimers();
		await act(async () => finish(new Response('{"entries":[{"toolCallId":"call-1"}]}', { headers: { "Content-Type": "application/json" } })));
		expect(click).toHaveBeenCalledOnce();
		expect(await (createUrl.mock.calls[0][0] as Blob).text()).toContain('"toolCallId":"call-1"');
		expect(button.disabled).toBe(false);
		expect(document.querySelector('a[download]')).toBeNull();
		await act(async () => vi.advanceTimersByTime(10_000));
		expect(revokeUrl).toHaveBeenCalledWith("blob:session-export");
	} finally {
		vi.useRealTimers();
		createUrl.mockRestore(); revokeUrl.mockRestore(); click.mockRestore();
	}
});

it("shows export failures and disables export when disconnected", async () => {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })));
	const button = container.querySelector<HTMLButtonElement>('button[aria-label="Export session"]')!;
	await act(async () => button.click());
	expect(document.body.textContent).toContain("Export failed (403).");
	expect(button.disabled).toBe(false);
	await act(async () => store.getState().actions.setConnection("disconnected", "Offline"));
	expect(button.disabled).toBe(true);
});

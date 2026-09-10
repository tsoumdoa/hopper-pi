// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolsDialog } from "./tools-dialog";

let root: Root;
let container: HTMLDivElement;
const tools = [
	{
		name: "read", description: "Read skill references", active: true,
		parameters: { type: "object", required: ["path"], properties: { path: { type: "string", description: "File to read" }, limit: { type: "number", minimum: 1, default: 200 } } },
	},
	{
		name: "gh_edit", description: "Edit Grasshopper components", active: false,
		parameters: { type: "object", required: ["items"], properties: { items: { type: "array", items: { anyOf: [
			{ type: "object", required: ["action", "typeGuid"], properties: { action: { type: "string", const: "add" }, typeGuid: { type: "string" } } },
			{ type: "object", required: ["action", "targetId"], properties: { action: { type: "string", const: "delete" }, targetId: { type: "string" } } },
		] } } } },
	},
	{
		name: "rh_document", description: "Manage the document", active: true,
		parameters: { type: "object", properties: { mode: { anyOf: [{ type: "string", const: "open" }, { type: "string", const: "save" }] } } },
	},
];

beforeEach(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tools }))));
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

async function render(connected = true, token = "test-token") {
	await act(async () => root.render(createElement(ToolsDialog, { token, connected, onOpenChange: () => {} })));
}

const toolButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-tool]"));
const detail = () => document.querySelector('[aria-labelledby="tool-detail-title"]');
const setInput = (input: HTMLInputElement, value: string) => {
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
};

it("filters tools by search and active state", async () => {
	await render();
	const input = document.querySelector<HTMLInputElement>('[aria-label="Search tools"]')!;
	await act(async () => setInput(input, "grasshopper"));
	expect(toolButtons().map((button) => button.dataset.tool)).toEqual(["gh_edit"]);

	await act(async () => setInput(input, ""));
	const activeOnly = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Active only")!;
	await act(async () => activeOnly.click());
	expect(toolButtons().map((button) => button.dataset.tool)).toEqual(["rh_document", "read"]);
});

it("recovers missed activation events with fallback polling, keeps the selection, and stops requests when disconnected", async () => {
	vi.useFakeTimers();
	await render();
	await act(async () => toolButtons().find((button) => button.dataset.tool === "gh_edit")!.click());
	vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ tools: tools.map((tool) => ({ ...tool, active: true })) })));
	await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
	expect(fetch).toHaveBeenCalledOnce();
	await act(async () => { await vi.advanceTimersByTimeAsync(27_000); });
	expect(document.body.textContent).toContain("3 active · 3 registered");
	expect(detail()?.querySelector("h2")?.textContent).toBe("gh_edit");
	expect(detail()?.textContent).toContain("Active");
	expect(detail()?.textContent).not.toContain("Inactive");
	await render(false);
	vi.mocked(fetch).mockClear();
	await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
	expect(fetch).not.toHaveBeenCalled();
	expect(document.body.textContent).toContain("Disconnected.");
});

it("reports failures and supports retry and an empty registry", async () => {
	vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "Host unavailable" }), { status: 503 }));
	await render();
	expect(document.querySelector('[role="alert"]')?.textContent).toContain("Host unavailable");
	vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ tools: [] })));
	await act(async () => Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Refresh")!.click());
	expect(document.querySelector('[role="alert"]')).toBeNull();
	expect(document.body.textContent).toContain("No tools are registered in this session.");
});

it("renders real widget intersection fields and keeps the original JSON schema", async () => {
	const { ghCreateWidgetTool } = await import("../../../src/tools/edit-tools/gh-create-widget.js");
	const { ghMutateWidgetTool } = await import("../../../src/tools/edit-tools/gh-mutate-widget.js");
	const widgets = [ghCreateWidgetTool, ghMutateWidgetTool];
	vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ tools: widgets.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters, active: true })) })));
	await render();
	for (const tool of widgets) {
		await act(async () => toolButtons().find((button) => button.dataset.tool === tool.name)!.click());
		const parameters = detail()!.querySelector('section[aria-labelledby="tool-parameters-title"]')!;
		expect(parameters.textContent).toContain("widgetType = slider");
		expect(parameters.textContent).not.toContain("any[]");
		const requiredField = Array.from(parameters.querySelectorAll("li")).find((item) => item.querySelector("code")?.textContent === (tool.name === "gh_create_widget" ? "x" : "targetId"));
		expect(requiredField?.textContent).toContain("Required");
		expect(JSON.parse(detail()!.querySelector("pre")!.textContent!)).toEqual(JSON.parse(JSON.stringify(tool.parameters)));
	}
});

const settingsSnapshot = (revision = 0, enabled = false, status = "missing") => ({
	tools: [{ name: "web_search", description: "Search public webpages", parameters: { type: "object" }, active: false, id: "firecrawl.web_search", parent: "firecrawl", enabled: true, available: false, status: enabled ? "api-key-required" : "parent-disabled" }],
	settings: { version: { epoch: "profile", revision }, parents: [{ id: "firecrawl", name: "Firecrawl", enabled, credential: { label: "Firecrawl API key", notice: "Queries go to Firecrawl.", status } }] },
});
const buttonNamed = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === name)!;

it("cancels key setup without saving and reopens with the current version", async () => {
	vi.mocked(fetch).mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === "POST" ? { ok: true, snapshot: settingsSnapshot(3, false, "configured") } : settingsSnapshot())));
	await render();
	await act(async () => buttonNamed("Manage API key").click());
	await act(async () => setInput(document.querySelector<HTMLInputElement>('[aria-label="Firecrawl API key"]')!, "discarded-secret"));
	await act(async () => buttonNamed("Cancel").click());
	expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
	await pushSettings(settingsSnapshot(2));
	await act(async () => buttonNamed("Manage API key").click());
	expect(document.querySelector<HTMLInputElement>('[aria-label="Firecrawl API key"]')!.value).toBe("");
	await act(async () => setInput(document.querySelector<HTMLInputElement>('[aria-label="Firecrawl API key"]')!, "test-secret"));
	await act(async () => buttonNamed("Save key").click());
	const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")!;
	expect(JSON.parse(post[1]!.body as string)).toEqual({ type: "credential", pluginId: "firecrawl", expected: { epoch: "profile", revision: 2 }, action: "save", key: "test-secret" });
	expect(document.querySelector<HTMLInputElement>('[aria-label="Enable Firecrawl"]')!.checked).toBe(false);
	expect(document.querySelector('[aria-label="Firecrawl API key"]')).toBeNull();
	expect(document.body.textContent).not.toContain("test-secret");
});

it("enables a mixed plugin without a key while its keyed tool remains unavailable", async () => {
	const initial = settingsSnapshot();
	initial.tools.push({ ...initial.tools[0], name: "web_help", id: "firecrawl.tool.help", description: "Local help" });
	const enabled = structuredClone(initial);
	enabled.settings.version.revision++;
	enabled.settings.parents[0].enabled = true;
	enabled.tools[0].status = "api-key-required";
	Object.assign(enabled.tools[1], { active: true, available: true, status: "active" });
	vi.mocked(fetch).mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === "POST" ? { ok: true, snapshot: enabled } : initial)));
	await render();
	await act(async () => document.querySelector<HTMLInputElement>('[aria-label="Enable Firecrawl"]')!.click());
	const posts = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");
	expect(posts).toHaveLength(1);
	expect(JSON.parse(posts[0][1]!.body as string)).toEqual({ type: "patch", expected: initial.settings.version, patch: { target: "parents", id: "firecrawl", enabled: true } });
	expect(document.querySelector('[aria-label="Firecrawl API key"]')).toBeNull();
	expect(document.querySelector<HTMLInputElement>('[aria-label="Enable Firecrawl"]')!.checked).toBe(true);
	expect(document.body.textContent).toContain("API key required");
	await act(async () => buttonNamed("Active only").click());
	expect(document.querySelector('[data-tool="web_help"]')).not.toBeNull();
	expect(document.querySelector('[data-tool="web_search"]')).toBeNull();
});

it("manages a key without enabling and refreshes a conflict without replay", async () => {
	vi.mocked(fetch).mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === "POST" ? { ok: false, code: "conflict", snapshot: settingsSnapshot(2) } : settingsSnapshot()), { status: init?.method === "POST" ? 409 : 200 }));
	await render();
	await act(async () => buttonNamed("Manage API key").click());
	await act(async () => setInput(document.querySelector<HTMLInputElement>('[aria-label="Firecrawl API key"]')!, "test-secret"));
	await act(async () => buttonNamed("Save key").click());
	const posts = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");
	expect(posts).toHaveLength(1);
	expect(JSON.parse(posts[0][1]!.body as string).action).toBe("save");
	expect(document.body.textContent).toContain("Settings changed in another window; review and try again.");
	expect(document.querySelector<HTMLInputElement>('[aria-label="Enable Firecrawl"]')!.checked).toBe(false);
	expect(document.querySelector('[aria-label="Firecrawl API key"]')).toBeNull();
});

it("keeps confirmed settings while saving and blocks changes when disconnected", async () => {
	let resolveSave!: (response: Response) => void;
	vi.mocked(fetch).mockImplementation(async (_url, init) => init?.method === "POST" ? new Promise<Response>((resolve) => { resolveSave = resolve; }) : new Response(JSON.stringify(settingsSnapshot(0, true, "configured"))));
	await render();
	const parent = () => document.querySelector<HTMLInputElement>('[aria-label="Enable Firecrawl"]')!;
	await act(async () => parent().click());
	expect(parent().checked).toBe(true);
	expect(parent().disabled).toBe(true);
	expect(document.body.textContent).toContain("Saving");
	await act(async () => resolveSave(new Response(JSON.stringify({ ok: false, error: "Could not save tool settings", snapshot: settingsSnapshot(0, true) }), { status: 400 })));
	expect(parent().checked).toBe(true);
	await render(false);
	expect(parent().disabled).toBe(true);
});

const pushSettings = async (snapshot: ReturnType<typeof settingsSnapshot>) => {
	await act(async () => window.dispatchEvent(new CustomEvent("hopper-tool-settings", { detail: snapshot })));
};
const parentEnabled = () => document.querySelector<HTMLInputElement>('[aria-label="Enable Firecrawl"]')!.checked;

it("uses pushed snapshots without a GET and ignores older revisions and retired epochs", async () => {
	vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(settingsSnapshot(2, true))));
	await render();
	await pushSettings(settingsSnapshot(3, false));
	expect(parentEnabled()).toBe(false);
	expect(fetch).toHaveBeenCalledTimes(1);
	await pushSettings(settingsSnapshot(2, true));
	expect(parentEnabled()).toBe(false);
	const reset = settingsSnapshot(0, true);
	reset.settings.version.epoch = "reset-profile";
	await pushSettings(reset);
	expect(parentEnabled()).toBe(true);
	await pushSettings(settingsSnapshot(4, false));
	expect(parentEnabled()).toBe(true);
});

it("does not let an older pending GET overwrite a pushed snapshot", async () => {
	let resolveGet!: (response: Response) => void;
	vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveGet = resolve; }));
	await render();
	await pushSettings(settingsSnapshot(2, true));
	await act(async () => resolveGet(new Response(JSON.stringify(settingsSnapshot(1, false)))));
	expect(parentEnabled()).toBe(true);
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(buttonNamed("Refresh").disabled).toBe(false);
});

it("does not let a delayed save response overwrite a newer pushed revision or epoch", async () => {
	let resolveSave!: (response: Response) => void;
	vi.mocked(fetch).mockImplementation(async (_url, init) => init?.method === "POST" ? new Promise<Response>((resolve) => { resolveSave = resolve; }) : new Response(JSON.stringify(settingsSnapshot(0, true))));
	await render();
	await act(async () => document.querySelector<HTMLInputElement>('[aria-label="Enable Firecrawl"]')!.click());
	await pushSettings(settingsSnapshot(2, true));
	await act(async () => resolveSave(new Response(JSON.stringify({ ok: true, snapshot: settingsSnapshot(1, false) }))));
	expect(parentEnabled()).toBe(true);
	await act(async () => document.querySelector<HTMLInputElement>('[aria-label="Enable Firecrawl"]')!.click());
	const reset = settingsSnapshot(0, true);
	reset.settings.version.epoch = "reset-profile";
	await pushSettings(reset);
	await act(async () => resolveSave(new Response(JSON.stringify({ ok: true, snapshot: settingsSnapshot(3, false) }))));
	expect(parentEnabled()).toBe(true);
});

it("recovers after a session change and discards responses from the old connection", async () => {
	let resolveSave!: (response: Response) => void;
	vi.mocked(fetch).mockImplementation(async (_url, init) => init?.method === "POST" ? new Promise<Response>((resolve) => { resolveSave = resolve; }) : new Response(JSON.stringify(settingsSnapshot(0, true))));
	await render();
	await act(async () => document.querySelector<HTMLInputElement>('[aria-label="Enable Firecrawl"]')!.click());
	await render(false);
	await act(async () => resolveSave(new Response(JSON.stringify({ ok: true, snapshot: settingsSnapshot(1, false) }))));
	expect(parentEnabled()).toBe(true);
	await render();
	vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(settingsSnapshot(0, false))));
	await act(async () => window.dispatchEvent(new Event("hopper-tools-session-changed")));
	expect(parentEnabled()).toBe(false);
});


it("resets profile revision history when the host token changes", async () => {
	vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(settingsSnapshot(2, true))));
	await render();
	const reset = settingsSnapshot(0, true);
	reset.settings.version.epoch = "reset-profile";
	await pushSettings(reset);
	const otherProfile = settingsSnapshot(0, false);
	otherProfile.settings.version.epoch = "third-profile";
	vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(otherProfile)));
	await render(true, "another-host-token");
	expect(parentEnabled()).toBe(false);
	await pushSettings(settingsSnapshot(3, true));
	expect(parentEnabled()).toBe(true);
});

it("renders an unknown plugin and targets only its credential actions", async () => {
	const initial = settingsSnapshot();
	initial.settings.parents.push({ id: "example", name: "Example", enabled: false, credential: { label: "Example API key", notice: "Requests go to Example.", status: "missing" } });
	initial.tools.push({ ...initial.tools[0], name: "example_lookup", id: "example.tool.lookup", parent: "example", description: "Example lookup" });
	const saved = structuredClone(initial);
	saved.settings.version.revision++;
	saved.settings.parents[1].enabled = false;
	saved.settings.parents[1].credential.status = "configured";
	vi.mocked(fetch).mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === "POST" ? { ok: true, snapshot: saved } : initial)));
	await render();
	expect(document.querySelector('button[data-tool="example_lookup"]')).not.toBeNull();
	await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Manage Example API key"]')!.click());
	expect(document.body.textContent).toContain("Requests go to Example.");
	await act(async () => setInput(document.querySelector<HTMLInputElement>('[aria-label="Example API key"]')!, "example-secret"));
	await act(async () => buttonNamed("Save key").click());
	const posts = () => vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(init!.body as string));
	expect(posts()[0]).toEqual({ type: "credential", pluginId: "example", expected: { epoch: "profile", revision: 0 }, action: "save", key: "example-secret" });
	expect(document.querySelector<HTMLInputElement>('[aria-label="Enable Firecrawl"]')!.checked).toBe(false);
	await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Manage Example API key"]')!.click());
	await act(async () => buttonNamed("Remove key").click());
	expect(posts()[1]).toMatchObject({ type: "credential", pluginId: "example", action: "remove" });
	expect(document.body.textContent).not.toContain("example-secret");
});

it("clears plugin key setup on session replacement", async () => {
	vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(settingsSnapshot())));
	await render();
	await act(async () => buttonNamed("Manage API key").click());
	await act(async () => setInput(document.querySelector<HTMLInputElement>('[aria-label="Firecrawl API key"]')!, "not-submitted"));
	await act(async () => window.dispatchEvent(new Event("hopper-tools-session-changed")));
	expect(document.querySelector('[aria-label="Firecrawl API key"]')).toBeNull();
	expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});

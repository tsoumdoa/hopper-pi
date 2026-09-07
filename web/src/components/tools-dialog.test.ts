// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolsDialog, schemaType } from "./tools-dialog";

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

async function render(connected = true) {
	await act(async () => root.render(createElement(ToolsDialog, { token: "test-token", connected, onOpenChange: () => {} })));
}

const toolButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-tool]"));
const detail = () => document.querySelector('[aria-labelledby="tool-detail-title"]');
const setInput = (input: HTMLInputElement, value: string) => {
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
};

it("groups tools, selects the first by group order, and renders parameters as a table", async () => {
	await render();
	expect(fetch).toHaveBeenCalledWith("/api/tools", expect.objectContaining({ headers: { Authorization: "Bearer test-token" }, cache: "no-store" }));
	expect(document.body.textContent).toContain("2 active · 3 registered");
	expect(Array.from(document.querySelectorAll("nav section h2"), (heading) => heading.textContent)).toEqual(["Rhino", "Grasshopper", "General"]);
	expect(toolButtons().map((button) => button.dataset.tool)).toEqual(["rh_document", "gh_edit", "read"]);

	// Rhino comes first, so rh_document is selected on open and its literal options render as chips.
	expect(document.querySelector('[aria-current="true"]')?.getAttribute("data-tool")).toBe("rh_document");
	expect(detail()?.querySelector("h2")?.textContent).toBe("rh_document");
	expect(Array.from(detail()!.querySelectorAll('[aria-label="mode options"] li'), (item) => item.textContent)).toEqual(["open", "save"]);
	expect(detail()?.textContent).toContain("1 parameter");

	await act(async () => toolButtons().find((button) => button.dataset.tool === "read")!.click());
	expect(detail()?.querySelector("h2")?.textContent).toBe("read");
	expect(detail()?.textContent).toContain("2 parameters · 1 required");
	expect(detail()?.textContent).toContain("File to read");
	expect(detail()?.textContent).toContain("Required");
	expect(detail()?.textContent).toContain("at least 1");
	expect(detail()?.textContent).toContain("Default 200");
	expect(detail()?.querySelector("pre")?.textContent).toContain('"path"');

	// Discriminated array items render as separate shapes, with the discriminator lifted into the heading.
	await act(async () => toolButtons().find((button) => button.dataset.tool === "gh_edit")!.click());
	expect(detail()?.textContent).toContain("Inactive");
	expect(detail()?.textContent).toContain("One of 2 shapes");
	expect(detail()?.textContent).toContain("action = add");
	expect(detail()?.textContent).toContain("typeGuid");
	expect(detail()?.textContent).toContain("action = delete");
});

it("filters by search and active state and moves the selection with arrow keys", async () => {
	await render();
	const input = document.querySelector<HTMLInputElement>('[aria-label="Search tools"]')!;
	for (const [query, names] of [["grasshopper", ["gh_edit"]], ["rhino", ["rh_document"]], ["read", ["read"]], ["missing", []]] as const) {
		await act(async () => setInput(input, query));
		expect(toolButtons().map((button) => button.dataset.tool)).toEqual(names);
		expect(document.querySelectorAll("nav section")).toHaveLength(names.length);
		if (names.length) expect(detail()?.querySelector("h2")?.textContent).toBe(names[0]);
	}
	expect(document.body.textContent).toContain("No tools match your search.");
	expect(detail()).toBeNull();

	await act(async () => setInput(input, ""));
	const activeOnly = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Active only")!;
	await act(async () => activeOnly.click());
	expect(activeOnly.getAttribute("aria-pressed")).toBe("true");
	expect(toolButtons().map((button) => button.dataset.tool)).toEqual(["rh_document", "read"]);
	expect(document.body.textContent).toContain("2 matching");

	const nav = document.querySelector<HTMLElement>('nav[aria-label="Tools"]')!;
	await act(async () => { nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
	expect(document.querySelector('[aria-current="true"]')?.getAttribute("data-tool")).toBe("read");
	await act(async () => { nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })); });
	expect(document.querySelector('[aria-current="true"]')?.getAttribute("data-tool")).toBe("rh_document");
	await act(async () => { nav.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })); });
	expect(document.querySelector('[aria-current="true"]')?.getAttribute("data-tool")).toBe("read");
});

it("polls for activation changes, keeps the selection, and stops requests when disconnected", async () => {
	vi.useFakeTimers();
	await render();
	await act(async () => toolButtons().find((button) => button.dataset.tool === "gh_edit")!.click());
	vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ tools: tools.map((tool) => ({ ...tool, active: true })) })));
	await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
	expect(document.body.textContent).toContain("3 active · 3 registered");
	expect(detail()?.querySelector("h2")?.textContent).toBe("gh_edit");
	expect(detail()?.textContent).toContain("Active");
	expect(detail()?.textContent).not.toContain("Inactive");
	await render(false);
	vi.mocked(fetch).mockClear();
	await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
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

it("describes JSON schema types in a compact form", () => {
	expect(schemaType({ type: "string" })).toBe("string");
	expect(schemaType({ type: ["string", "null"] })).toBe("string | null");
	expect(schemaType({ type: "array", items: { type: "number" } })).toBe("number[]");
	expect(schemaType({ type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } })).toBe("(string | number)[]");
	expect(schemaType({ anyOf: [{ type: "string", const: "a" }, { type: "string", const: "b" }] })).toBe("string");
	expect(schemaType({ enum: [1, 2] })).toBe("number");
	expect(schemaType({ properties: {} })).toBe("object");
	expect(schemaType({})).toBe("any");
});

// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolsDialog } from "./tools-dialog";

let root: Root;
let container: HTMLDivElement;
const tools = [
	{ name: "read", description: "Read skill references", parameters: { type: "object", properties: { path: { type: "string" } } }, active: true },
	{ name: "gh_edit", description: "Edit Grasshopper components", parameters: { type: "object" }, active: false },
	{ name: "rh_document", description: "Manage the document", parameters: { type: "object" }, active: true },
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

it("shows status and parameters and searches names and descriptions", async () => {
	await render();
	expect(fetch).toHaveBeenCalledWith("/api/tools", expect.objectContaining({ headers: { Authorization: "Bearer test-token" }, cache: "no-store" }));
	expect(document.body.textContent).toContain("2 active · 3 registered");
	expect(Array.from(document.querySelectorAll("section h2"), (heading) => heading.textContent)).toEqual(["Rhino", "Grasshopper", "General"]);
	expect(document.querySelector('[aria-labelledby="tools-group-Rhino"]')?.textContent).toContain("rh_document");
	expect(document.querySelector('[aria-labelledby="tools-group-Grasshopper"]')?.textContent).toContain("gh_edit");
	expect(document.querySelector('[aria-labelledby="tools-group-General"] pre')?.textContent).toContain('"path"');
	const input = document.querySelector<HTMLInputElement>('[aria-label="Search tools"]')!;
	const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
	for (const [query, count] of [["grasshopper", 1], ["rhino", 1], ["general", 1], ["read", 1], ["missing", 0]] as const) {
		await act(async () => { setValue.call(input, query); input.dispatchEvent(new Event("input", { bubbles: true })); });
		expect(document.querySelectorAll("article")).toHaveLength(count);
		expect(document.querySelectorAll("section")).toHaveLength(count);
	}
	expect(document.body.textContent).toContain("No tools match your search.");
});

it("polls for activation changes and stops requests when disconnected", async () => {
	vi.useFakeTimers();
	await render();
	vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ tools: tools.map((tool) => ({ ...tool, active: true })) })));
	await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
	expect(document.body.textContent).toContain("3 active · 3 registered");
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

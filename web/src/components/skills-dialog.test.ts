// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SkillsDialog } from "./skills-dialog";
import type { SkillLibrarySnapshot } from "../../../src/host/protocol.js";

let root: Root;
let container: HTMLDivElement;
let library: SkillLibrarySnapshot;
let requests: Array<{ url: string; body?: string }>;

beforeEach(() => {
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	library = { folder: "/local/markdown", diagnostics: [], skills: [{
		id: "bundled:rhino", name: "rhino-document", description: "Edit Rhino geometry", path: "/bundled/SKILL.md",
		source: "bundled", enabled: true, manualOnly: false, files: ["/bundled/SKILL.md", "/bundled/reference.md"],
	}] };
	requests = [];
	vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
		requests.push({ url, body: init?.body as string | undefined });
		if (init?.body) {
			const update = JSON.parse(String(init.body));
			if (update.type === "toggle") library = { ...library, skills: library.skills.map((skill) => ({ ...skill, enabled: update.enabled })) };
		}
		return new Response(JSON.stringify(url.includes("?file=") ? { content: "# Rhino instructions\nUse rh_run_script." } : library));
	}));
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

async function render(streaming = false) {
	await act(async () => root.render(createElement(SkillsDialog, { token: "test-token", connected: true, streaming, onOpenChange: () => {} })));
}

it("shows available skills and applies a persisted toggle from the server response", async () => {
	await render();
	expect(document.body.textContent).toContain("1 of 1 enabled");
	const toggle = document.querySelector<HTMLInputElement>('[role="switch"]')!;
	await act(async () => toggle.click());
	expect(requests.find((request) => request.body)?.body).toBe(JSON.stringify({ type: "toggle", id: "bundled:rhino", enabled: false }));
	expect(document.body.textContent).toContain("0 of 1 enabled");
	expect(toggle.checked).toBe(false);
});

it("previews Markdown and reference choices without exposing raw HTML", async () => {
	await render();
	await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="View rhino-document"]')!.click());
	expect(document.querySelector("pre")?.textContent).toContain("Use rh_run_script.");
	expect(document.querySelectorAll("select option")).toHaveLength(2);
	expect(requests.some((request) => request.url.includes(encodeURIComponent("/bundled/SKILL.md")))).toBe(true);
});

it("keeps viewing available and prevents changes during an agent turn", async () => {
	await render(true);
	expect(document.querySelector<HTMLInputElement>('[role="switch"]')!.disabled).toBe(true);
	expect(document.querySelector<HTMLButtonElement>('[aria-label="View rhino-document"]')!.disabled).toBe(false);
	expect(document.body.textContent).toContain("change them when this turn finishes");
});

it("automatically shows Markdown added to the folder on the next poll", async () => {
	vi.useFakeTimers();
	try {
		await render();
		library = { ...library, skills: [...library.skills, { ...library.skills[0], id: "user:office", name: "office-rules", source: "user" }] };
		await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
		expect(document.body.textContent).toContain("office-rules");
		expect(document.body.textContent).toContain("2 of 2 enabled");
	} finally { vi.useRealTimers(); }
});

it("filters by search and enabled status and clears an empty result", async () => {
	library.skills.push({ ...library.skills[0], id: "user:office", name: "office-rules", description: "Office standards", source: "user", enabled: false, path: "/local/office.md", files: ["/local/office.md"] });
	await render();
	const search = document.querySelector<HTMLInputElement>('[aria-label="Search skills"]')!;
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "office");
		search.dispatchEvent(new Event("input", { bubbles: true }));
	});
	expect(document.querySelectorAll("[data-skill]")).toHaveLength(1);
	expect(document.querySelector("#skill-detail-title")?.textContent).toBe("office-rules");
	await act(async () => Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Enabled only")!.click());
	expect(document.body.textContent).toContain("No skills match your filters.");
	await act(async () => Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Clear filters")!.click());
	expect(document.querySelectorAll("[data-skill]")).toHaveLength(2);
});

it("supports keyboard selection and selecting reference files", async () => {
	library.skills.push({ ...library.skills[0], id: "user:office", name: "office-rules", source: "user", path: "/local/office.md", files: ["/local/office.md"] });
	await render();
	await act(async () => document.querySelector('[aria-label="Skills"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
	expect(document.querySelector("#skill-detail-title")?.textContent).toBe("office-rules");
	expect(document.activeElement?.getAttribute("data-skill")).toBe("user:office");
	await act(async () => document.querySelector('[aria-label="Skills"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
	const select = document.querySelector<HTMLSelectElement>("#skill-file")!;
	await act(async () => { select.value = "/bundled/reference.md"; select.dispatchEvent(new Event("change", { bubbles: true })); });
	expect(requests.at(-1)?.url).toContain(encodeURIComponent("/bundled/reference.md"));
});

it("keeps folder edits across polls and submits the chosen folder", async () => {
	vi.useFakeTimers();
	try {
		await render();
		await act(async () => document.querySelector<HTMLButtonElement>('[aria-controls="skill-folder-settings"]')!.click());
		const input = document.querySelector<HTMLInputElement>("#skill-folder")!;
		await act(async () => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "/new/markdown");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
		expect(input.value).toBe("/new/markdown");
		await act(async () => Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Use folder")!.click());
		expect(requests.find((request) => request.body)?.body).toBe(JSON.stringify({ type: "folder", folder: "/new/markdown" }));
	} finally { vi.useRealTimers(); }
});

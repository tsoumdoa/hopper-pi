import { expect, it, vi } from "vitest";
import { sharedToolSettings } from "./tool-settings.js";
import type { AgentToolsSnapshot } from "../protocol.js";

const target = { kind: "rhino", lifecycleInstanceId: "second-rhino", rhinoDocumentId: "doc" };
function fixture() {
	const snapshot: AgentToolsSnapshot = { tools: [] };
	const admin = {
		getToolSettings: vi.fn(async (_online?: boolean) => snapshot),
		updateToolSettings: vi.fn(async () => ({ ok: true, snapshot })),
	};
	const current = {
		getToolSettings: vi.fn(async () => ({ tools: [{ name: "rh_run_script", active: true, description: "Run", parameters: {} }] })),
		updateToolSettings: vi.fn(async () => ({ ok: true, snapshot })),
	};
	const tasks = { toolSettings: vi.fn((conversation: string, task: string) => conversation === "conversation" && task === "running" ? current : undefined) };
	const checkConnection = vi.fn(async () => true);
	const query = new URLSearchParams({ conversationId: "conversation", target: JSON.stringify(target) });
	const api = () => sharedToolSettings(query, { admin, tasks, checkConnection });
	return { admin, current, tasks, checkConnection, query, api };
}

it("previews the selected Rhino connection instead of the admin session", async () => {
	const f = fixture();
	expect(await f.api().getToolSettings()).toMatchObject({ context: { kind: "target" } });
	expect(f.checkConnection).toHaveBeenCalledWith(target);
	expect(f.admin.getToolSettings).toHaveBeenCalledWith(true);
	f.checkConnection.mockResolvedValue(false);
	await f.api().updateToolSettings({ type: "check-connection" });
	expect(f.admin.getToolSettings).toHaveBeenLastCalledWith(false);
	expect(f.admin.updateToolSettings).not.toHaveBeenCalled();
});

it("uses the running task for status and session activation", async () => {
	const f = fixture();
	f.query.set("taskId", "running");
	expect(await f.api().getToolSettings()).toMatchObject({ context: { kind: "task", taskId: "running" }, tools: [{ active: true }] });
	const action = { type: "activate" as const, id: "hopper.tool.rh_document" };
	await f.api().updateToolSettings(action);
	expect(f.current.updateToolSettings).toHaveBeenCalledWith(action);
	expect(f.admin.getToolSettings).not.toHaveBeenCalled();
	expect(f.checkConnection).not.toHaveBeenCalled();
});

it("does not activate an admin tool when a task ended or belongs to another conversation", async () => {
	const f = fixture();
	f.query.set("taskId", "running");
	f.query.set("conversationId", "other");
	expect(await f.api().updateToolSettings({ type: "activate", id: "hopper.tool.rh_document" })).toMatchObject({ ok: false, snapshot: { context: { kind: "target" } } });
	expect(f.current.updateToolSettings).not.toHaveBeenCalled();
	expect(f.admin.updateToolSettings).not.toHaveBeenCalled();
});

it("keeps saved changes profile-wide but returns a fresh target preview", async () => {
	const f = fixture();
	await f.api().updateToolSettings({ type: "repair" });
	expect(f.admin.updateToolSettings).toHaveBeenCalledWith({ type: "repair" });
	expect(f.admin.getToolSettings).toHaveBeenCalledWith(true);
	f.query.delete("target");
	f.checkConnection.mockClear();
	expect(await f.api().getToolSettings()).toMatchObject({ context: { label: expect.stringContaining("Select a Rhino target") } });
	expect(f.admin.getToolSettings).toHaveBeenLastCalledWith(false);
	expect(f.checkConnection).not.toHaveBeenCalled();
});

it("rejects malformed targets before probing a connection", () => {
	const f = fixture();
	f.query.set("target", JSON.stringify({ kind: "rhino" }));
	expect(f.api).toThrow("Invalid tool target");
	expect(f.checkConnection).not.toHaveBeenCalled();
});



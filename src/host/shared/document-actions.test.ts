import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { TaskJournal } from "./journal.js";
import { SharedTaskService, type DriverContext } from "./task-service.js";
import { DocumentActionService, type DocumentActionRequest } from "./document-actions.js";
import { createPiTaskDriver } from "./pi-driver.js";
import { setCachedBackendStatus } from "../../infra/backend-status-cache.js";
import { RuntimeSessionContext } from "../../infra/runtime-session-context.js";
import type { TargetBinding } from "../../protocol/shared-execution.js";
import { ToolPolicyStore } from "../../services/tool-policy-store.js";
import { HOPPER_POLICY_INVENTORY } from "../../tools/policy-inventory.js";
import { admitDocumentTool } from "./document-tool-policy.js";

const old: TargetBinding = { kind: "rhino", lifecycleInstanceId: "life", rhinoDocumentId: "old" };
const other: TargetBinding = { ...old, lifecycleInstanceId: "other" };
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

async function fixture(options: { kind?: "rhino" | "grasshopper"; action?: "new" | "open"; hostOnly?: boolean; fail?: boolean; disabled?: boolean; revoke?: boolean; unverified?: boolean; cancel?: boolean } = {}) {
 const root = await mkdtemp(join(tmpdir(), "document-actions-"));
 const journal = new TaskJournal(":memory:");
 const kind = options.kind ?? "rhino", action = options.action ?? "new";
 const resultBinding: TargetBinding = kind === "rhino" ? { kind: "rhino", lifecycleInstanceId: "life", rhinoDocumentId: "new" }
  : { kind, lifecycleInstanceId: "life", grasshopperDocumentId: "new-gh", associatedRhinoDocumentId: "old" };
 const contexts: DriverContext[] = [], order: string[] = [], toolNames: string[][] = [];
 const requests: DocumentActionRequest[] = [];
 let actions!: DocumentActionService;
 const directory = join(root, "settings");
 const store = new ToolPolicyStore(HOPPER_POLICY_INVENTORY, { directory });
 if (options.disabled) await store.update(await store.read(), { target: "tools", id: "hopper.tool.rh_document", enabled: false });
 const execute = vi.fn(async () => { order.push("execute"); return { binding: resultBinding, result: { ok: true } }; });
 const scheduler = new SharedTaskService(journal, {
  maxWorkers: 1,
  resolveBinding: () => ({ processKey: "process", attachmentGeneration: "generation" }),
  resolveLifecycle: () => ({ processKey: "process", attachmentGeneration: "generation" }), validateBinding: () => {},
  createDriver: async context => {
   contexts.push(context);
   return createPiTaskDriver(context, {
    dataDirectory: root, authPath: join(root, "auth.json"), toolConfigDir: directory,
    geometry: async () => { const runtimeSession = new RuntimeSessionContext(); runtimeSession.run(() => setCachedBackendStatus({ online: true })); return { runtimeSession,
     runTool: async () => { throw new Error("Create/open must not acquire the old document's native lease"); },
     cleanup: async () => { order.push("cleanup"); return { confirmed: true }; } }; },
    documentActions: { prepare: (id, kind, request) => actions.prepareForTask(context, id, kind, request) },
    configureSession(session) {
     let calls = 0;
     session.agent.streamFunction = (model, input) => {
      toolNames.push(input.tools?.map(tool => tool.name) ?? []);
      const perform = !context.continuation && calls++ === 0;
      const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
       timestamp: Date.now(), stopReason: perform ? "toolUse" : "stop",
       content: perform ? [{ type: "toolCall", id: "open-call", name: kind === "rhino" ? "rh_document" : "gh_document",
        arguments: { action, ...(action === "open" ? { path: kind === "rhino" ? "/models/new.3dm" : "/models/new.gh" } : {}),
         ...(options.hostOnly ? { lifecycleInstanceId: "life" } : {}) } }] : [{ type: "text", text: "Done" }],
       usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream(); stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }); return stream;
     };
    },
   });
  },
 });
 actions = new DocumentActionService(journal, scheduler, {
  preflight: async request => {
   order.push("preflight"); requests.push(request);
   if (options.revoke) await store.update(await store.read(), { target: "tools", id: "hopper.tool.rh_document", enabled: false });
   if (options.cancel) void scheduler.cancel(request.taskId, "cancel-document");
   if (options.fail) throw new Error("The replaced document has unsaved changes; ask whether to save or discard.");
   return { destinations: [] };
  }, execute, verify: async () => { if (options.unverified) throw new Error("Could not verify resulting document"); },
 }, kind => admitDocumentTool(kind, directory));
 scheduler.setDocumentActionExecutor(id => actions.execute(id));
 const conversation = journal.createConversation("conversation", "Document tools");
 const receipt = scheduler.submit({ ...conversation, requestId: "plain-message", kind: "prompt", text: "Open a document",
  bindings: options.hostOnly ? [old, other] : [old], attachments: [] });
 return { journal, scheduler, actions, contexts, order, requests, execute, resultBinding, toolNames, receipt,
  async wait() {
   for (let i = 0; i < 600; i++) {
    const task = journal.snapshot().tasks.find(row => row.id === receipt.taskId)!;
    if (["completed", "failed", "cancelled", "uncertain"].includes(String(task.state))) return task;
    await tick();
   }
   throw new Error("Document task did not finish");
  },
  async close() { await scheduler.stop(); journal.close(); await store.close(); await rm(root, { recursive: true, force: true }); },
 };
}

it.each([
 ["rhino", "new", false], ["rhino", "open", false], ["grasshopper", "new", false], ["grasshopper", "open", false],
 ["rhino", "new", true], ["grasshopper", "open", true],
] as const)("runs %s %s from an ordinary tool call, host-only=%s", async (kind, action, hostOnly) => {
 const f = await fixture({ kind, action, hostOnly });
 try {
  expect((await f.wait()).state).toBe("completed");
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.contexts).toHaveLength(2);
  expect(f.contexts[1]!.binding).toEqual(f.resultBinding);
  expect(f.requests[0]).toMatchObject({ kind, action, lifecycleInstanceId: "life", modifiedPolicy: "refuse" });
  if (!hostOnly) expect(f.order.indexOf("cleanup")).toBeLessThan(f.order.indexOf("execute"));
  const names = f.toolNames.flat();
  expect(names).toContain(kind === "rhino" ? "rh_document" : "gh_document");
  for (const removed of ["listDocumentGrants", "executeDocumentGrant", "launchRhino", "listRhinoLaunches"]) expect(names).not.toContain(removed);
  const grant = f.journal.snapshot().records.find(row => row.kind === "grant")!;
  expect(await f.actions.execute(String(grant.id))).toMatchObject({ binding: f.resultBinding });
  expect(f.execute).toHaveBeenCalledTimes(1);
 } finally { await f.close(); }
});

it.each([false, true])("returns an unsaved-work failure to the agent without changing its target, host-only=%s", async hostOnly => {
 const f = await fixture({ fail: true, hostOnly });
 try {
  expect((await f.wait()).state).toBe("completed");
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.contexts).toHaveLength(2);
  expect(f.contexts[1]!.binding).toEqual(hostOnly ? null : old);
  expect(f.contexts[1]!.continuation).toMatchObject({ documentAction: { failed: true, result: { ok: false, error: expect.stringContaining("unsaved") } } });
 } finally { await f.close(); }
});

it("rejects a disabled document tool before creating any action", async () => {
 const f = await fixture({ disabled: true });
 try {
  expect((await f.wait()).state).toBe("completed");
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.journal.snapshot().records.some(row => row.kind === "document-action")).toBe(false);
 } finally { await f.close(); }
});

it("resolves only accessible processes and requires a choice when the target is ambiguous", () => {
 const journal = new TaskJournal(":memory:");
 const scheduler = new SharedTaskService(journal, { createDriver: () => { throw Error("unused"); }, resolveBinding: () => ({ processKey: "p", attachmentGeneration: "g" }), validateBinding: () => {} });
 const actions = new DocumentActionService(journal, scheduler, { preflight: async () => ({ destinations: [] }), execute: async () => { throw Error("unused"); }, verify: async () => {} });
 try {
  const context = { taskId: "task", binding: null, accessibleBindings: [old, other] };
  expect(() => actions.prepareForTask(context, "id", "rhino", { action: "new" })).toThrow("Choose a process");
  expect(() => actions.prepareForTask(context, "id", "rhino", { action: "new", lifecycleInstanceId: "inaccessible" })).toThrow("accessible");
  expect(() => actions.prepareForTask({ ...context, accessibleBindings: [] }, "id", "rhino", { action: "new" })).toThrow("Open Rhino and run HopperCode");
 } finally { journal.close(); }
});

it("rechecks tool settings after document preflight before dispatch", async () => {
 const f = await fixture({ revoke: true });
 try {
  expect((await f.wait()).state).toBe("completed");
  expect(f.requests).toHaveLength(1);
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.contexts[1]!.continuation).toMatchObject({ documentAction: { failed: true, result: { error: expect.stringContaining("Tool unavailable") } } });
 } finally { await f.close(); }
});
it("keeps an executed but unverified document action uncertain", async () => {
 const f = await fixture({ unverified: true });
 try {
  expect((await f.wait()).state).toBe("uncertain");
  expect(f.execute).toHaveBeenCalledTimes(1);
  expect(f.contexts).toHaveLength(1);
 } finally { await f.close(); }
});
it("cancels before dispatch without creating a document or a continuation", async () => {
 const f = await fixture({ cancel: true });
 try {
  expect((await f.wait()).state).toBe("cancelled");
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.contexts).toHaveLength(1);
 } finally { await f.close(); }
});

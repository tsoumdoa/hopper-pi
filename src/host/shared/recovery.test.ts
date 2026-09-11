import { describe, it, expect } from "vitest";
import { TaskJournal } from "./journal.js";
import { SharedRegistry } from "./registry.js";
import { SharedTaskService } from "./task-service.js";
import { SharedRecoveryService, type RecoveryNative } from "./recovery.js";
import type { HopperRpcClient } from "../../infra/rpc-client.js";

describe("explicit recovery", () => {
	it("acknowledgement cannot release running work or unconfirmed cleanup, and successful retry does not rewrite the edit", async () => {
		const journal = new TaskJournal(":memory:");
		journal.registerSession("c", "s");
		const binding = {
			kind: "rhino" as const,
			lifecycleInstanceId: "life",
			rhinoDocumentId: "doc",
		};
		const task = journal.accept({
			requestId: "submit",
			conversationId: "c",
			sessionId: "s",
			kind: "prompt",
			text: "edit",
			bindings: [binding],
			attachments: [],
		});
		const owner = {
			taskId: task.taskId,
			turnId: task.turnId,
			binding,
			attachmentGeneration: "old",
		};
		journal.start(task.taskId, task.turnId, owner);
		journal.operationIntent({
			taskId: task.taskId,
			turnId: task.turnId,
			name: "runRhinoScript",
			operationClass: "mutation",
			arguments: {},
			deadline: 100,
			owner,
		});
		journal.recover();
		const registry = new SharedRegistry(journal);
		registry.register({
			lifecycleInstanceId: "life",
			processId: 123,
			processStartTime: "start",
			hostEpoch: "epoch",
			attachmentGeneration: "old",
			capabilities: [],
			documents: [binding],
			admission: "recovering",
			label: "Rhino",
		});
		let idle = false,
			calls = 0;
		const native: RecoveryNative = {
			getClient: () =>
				({
					call: async () => ({
						result: { class: "completed", data: { state: "not_found" } },
					}),
				}) as unknown as HopperRpcClient,
			reconcileAttachment: async () => {
				calls++;
				return {
					attachmentGeneration: "new",
					operationsIdle: idle,
					rhinoScopeIdle: idle,
					grasshopperScopeIdle: idle,
				};
			},
		};
		const tasks = new SharedTaskService(journal, {
			resolveBinding: (b) => registry.resolveBinding(b),
			resolveLifecycle: (id) => registry.resolveLifecycle(id),
			validateBinding: (o) => registry.validateBinding(o),
			createDriver: () => {
				throw new Error("no model");
			},
		});
		const recovery = new SharedRecoveryService(
			journal,
			registry,
			tasks,
			native,
			{ originalExited: async () => false },
		);
		await expect(recovery.recover("recover", task.taskId, "")).rejects.toThrow(
			"Acknowledge",
		);
		expect(calls).toBe(0);
		await expect(
			recovery.recover("recover", task.taskId, "I inspected the model"),
		).rejects.toThrow("unresolved");
		expect(journal.snapshot().recoveries).toHaveLength(0);
		idle = true;
		const receipt = await recovery.recover(
			"recover",
			task.taskId,
			"I inspected the model",
		);
		expect(journal.snapshot().recoveries).toHaveLength(1);
		idle = false;
		expect(
			await recovery.recover("recover", task.taskId, "I inspected the model"),
		).toEqual(receipt);
		expect(calls).toBe(2);
		await expect(
			recovery.recover("recover", task.taskId, "Different acknowledgement"),
		).rejects.toThrow("conflicts");
		expect(journal.snapshot().tasks[0]!.state).toBe("uncertain");
		expect(journal.snapshot().operations[0]!.state).toBe("dispatched");
	});
});

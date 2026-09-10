import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SharedHostControl } from "./control.js";
import { TaskJournal } from "./journal.js";
import { SharedRegistry } from "./registry.js";
import { createLaunchCoordinator } from "./launch-coordinator.js";
import type { DriverContext } from "./task-service.js";
const roots: string[] = [],
	journals: TaskJournal[] = [];
afterEach(() => {
	journals.splice(0).forEach((journal) => journal.close());
	roots
		.splice(0)
		.forEach((root) => rmSync(root, { recursive: true, force: true }));
});
async function setup(
	ready = true,
	launchWaitMs = 10,
	platform: NodeJS.Platform = "darwin",
	spawnGate?: Promise<void>,
) {
	const root = mkdtempSync(join(tmpdir(), "hopper-launch-coordinator-"));
	roots.push(root);
	const control = new SharedHostControl(join(root, "control"));
	const state = await control.initialize({
		defaultDataDirectory: join(root, "data"),
	});
	const journal = new TaskJournal(join(state.dataDirectory, "journal.sqlite"));
	journals.push(journal);
	const conversation = journal.createConversation("conversation", "test");
	const task = journal.accept({
		...conversation,
		requestId: "root",
		kind: "prompt",
		text: "start one Rhino",
		bindings: [],
		attachments: [],
	});
	const registry = new SharedRegistry(journal);
	let spawns = 0;
	let candidates: { pid: number; startIdentity: string }[] = [];
	const coordinator = await createLaunchCoordinator({
		journal,
		control,
		registry,
		launchWaitMs,
		launchPollMs: 1,
		platform,
		isProcessAlive: () => false,
		installations: [
			{
				id: "rhino",
				executable: "/test",
				platform: "darwin",
				build: "test",
				bootstrapVerified: ready,
				independentProcessVerified: false,
				bootstrapArguments: () => [],
			},
		],
		adapter: {
			snapshot: async () => candidates,
			spawn: async () => {
				spawns++;
				await spawnGate;
				return { pid: 12, startIdentity: "start" };
			},
		},
	});
	return {
		root,
		setCandidates: (value: typeof candidates) => {
			candidates = value;
		},
		control,
		journal,
		registry,
		coordinator,
		task,
		spawns: () => spawns,
		launch: (requestId = "launch", rootTaskId = task.taskId) => coordinator.tools({ taskId: rootTaskId, parentTaskId: null } as DriverContext)[1]!
			.execute("call", { installationId: "rhino", requestId }, undefined, undefined, {} as never),
	};
}
describe("production launch coordinator", () => {
	it("creates one root-task launch grant from the agent tool and observes retries", async () => {
		const f = await setup();
		const tools = f.coordinator.tools({
			taskId: f.task.taskId,
			parentTaskId: null,
		} as DriverContext);
		const launch = tools[1].execute as (
			id: string,
			args: { installationId: string; requestId?: string },
		) => Promise<any>;
		const first = await launch("call", { installationId: "rhino" });
		const requestId = first.details.request.requestId;
		expect(requestId).toMatch(/^agent-launch-[a-f0-9]{64}$/);
		expect(first.details.request.rootTaskId).toBe(f.task.taskId);
		await launch("retry", { installationId: "rhino", requestId });
		expect(f.spawns()).toBe(1);
	});
	it("does not let a child task authorize a process launch", async () => {
		const f = await setup();
		const launch = f.coordinator.tools({
			taskId: f.task.taskId,
			parentTaskId: "parent",
		} as DriverContext)[1].execute as (
			id: string,
			args: { installationId: string },
		) => Promise<unknown>;
		await expect(
			launch("call", { installationId: "rhino" }),
		).rejects.toThrow("root user request");
		expect(f.journal.snapshot().records).toEqual([]);
		expect(f.spawns()).toBe(0);
	});
	it("adds only one verified launched document after matching native bootstrap", async () => {
		const f = await setup();
		const launch = f.coordinator.tools({
			taskId: f.task.taskId,
		} as DriverContext)[1].execute as (
			id: string,
			args: { installationId: string; requestId?: string },
		) => Promise<unknown>;
		await launch("call", { installationId: "rhino", requestId: "launch" });
		const directory = join(f.control.directory, "bootstrap");
		const file = readdirSync(directory)[0];
		const ticket = JSON.parse(readFileSync(join(directory, file), "utf8"));
		const binding = {
			kind: "rhino" as const,
			lifecycleInstanceId: "lifecycle",
			rhinoDocumentId: "model",
		};
		f.registry.register({
			lifecycleInstanceId: "lifecycle",
			processId: 12,
			processStartTime: "start",
			hostEpoch: "epoch",
			attachmentGeneration: "generation",
			capabilities: [],
			documents: [binding],
			admission: "recovering",
			label: "Rhino",
		});
		f.registry.markReady("lifecycle", {
			authenticated: true,
			generation: "generation",
			operationsIdle: true,
			rhinoScopeIdle: true,
			grasshopperScopeIdle: true,
		});
		const process = { pid: 12, startIdentity: "start" };
		expect(
			(await f.coordinator.registered(
				{
					process,
					bootstrap: {
						...ticket,
						ticketId: file.slice(0, -5),
						process,
						lifecycleInstanceId: "lifecycle",
					},
				},
				{ lifecycleInstanceId: "lifecycle" },
			))!.state,
		).toBe("completed");
		expect(f.journal.authorizationAdditions(f.task.taskId)).toEqual([binding]);
		expect(
			(await f.coordinator.registered(
				{
					process,
					bootstrap: {
						...ticket,
						ticketId: file.slice(0, -5),
						process,
						lifecycleInstanceId: "lifecycle",
					},
				},
				{ lifecycleInstanceId: "lifecycle" },
			))!.state,
		).toBe("completed");
		expect(f.journal.authorizationAdditions(f.task.taskId)).toEqual([binding]);
	});
	it("reconciles late authenticated document readiness after startup timeout without respawning", async () => {
		const f = await setup();
		const launch = f.coordinator.tools({
			taskId: f.task.taskId,
		} as DriverContext)[1].execute as (
			id: string,
			args: { installationId: string; requestId?: string },
		) => Promise<unknown>;
		await launch("call", { installationId: "rhino", requestId: "launch" });
		const directory = join(f.control.directory, "bootstrap"),
			file = readdirSync(directory)[0],
			ticket = JSON.parse(readFileSync(join(directory, file), "utf8"));
		const process = { pid: 12, startIdentity: "start" };
		await f.coordinator.registered(
			{
				process,
				bootstrap: {
					...ticket,
					ticketId: file.slice(0, -5),
					process,
					lifecycleInstanceId: "lifecycle",
				},
			},
			{ lifecycleInstanceId: "lifecycle" },
		);
		const row = f.journal
			.snapshot()
			.records.find((row) => row.kind === "launch")!;
		const record = JSON.parse(String(row.payload));
		f.journal.persistLaunch({
			...record,
			state: "uncertain",
			detail: "UI startup timed out",
		});
		const binding = {
			kind: "rhino" as const,
			lifecycleInstanceId: "lifecycle",
			rhinoDocumentId: "model",
		};
		f.registry.register({
			lifecycleInstanceId: "lifecycle",
			processId: 12,
			processStartTime: "start",
			hostEpoch: "epoch",
			attachmentGeneration: "generation",
			capabilities: [],
			documents: [binding],
			admission: "recovering",
			label: "Rhino",
		});
		f.registry.markReady("lifecycle", {
			authenticated: true,
			generation: "generation",
			operationsIdle: true,
			rhinoScopeIdle: true,
			grasshopperScopeIdle: true,
		});
		await f.coordinator.refresh();
		expect(f.journal.authorizationAdditions(f.task.taskId)).toEqual([binding]);
		expect(f.spawns()).toBe(1);
	});
	it("holds the launch tool until authenticated document readiness instead of ending the root early", async () => {
		const f = await setup(true, 1000);
		const signal = new AbortController();
		const launch = f.coordinator.tools({
			taskId: f.task.taskId,
			signal: signal.signal,
		} as DriverContext)[1].execute as (
			id: string,
			args: { installationId: string; requestId?: string },
		) => Promise<any>;
		let finished = false;
		const pending = launch("call", { installationId: "rhino", requestId: "launch" }).then((result) => {
			finished = true;
			return result;
		});
		await vi.waitFor(() => expect(f.spawns()).toBe(1));
		expect(finished).toBe(false);
		const directory = join(f.control.directory, "bootstrap"),
			file = readdirSync(directory)[0],
			ticket = JSON.parse(readFileSync(join(directory, file), "utf8"));
		const process = { pid: 12, startIdentity: "start" };
		await f.coordinator.registered(
			{
				process,
				bootstrap: {
					...ticket,
					ticketId: file.slice(0, -5),
					process,
					lifecycleInstanceId: "lifecycle",
				},
			},
			{ lifecycleInstanceId: "lifecycle" },
		);
		expect(finished).toBe(false);
		const binding = {
			kind: "rhino" as const,
			lifecycleInstanceId: "lifecycle",
			rhinoDocumentId: "model",
		};
		f.registry.register({
			lifecycleInstanceId: "lifecycle",
			processId: 12,
			processStartTime: "start",
			hostEpoch: "epoch",
			attachmentGeneration: "generation",
			capabilities: [],
			documents: [binding],
			admission: "recovering",
			label: "Rhino",
		});
		f.registry.markReady("lifecycle", {
			authenticated: true,
			generation: "generation",
			operationsIdle: true,
			rhinoScopeIdle: true,
			grasshopperScopeIdle: true,
		});
		expect((await pending).details.state).toBe("completed");
		expect(f.spawns()).toBe(1);
	});
	it("returns bounded startup uncertainty and observes cancellation without another spawn", async () => {
		const f = await setup();
		const controller = new AbortController();
		const launch = f.coordinator.tools({
			taskId: f.task.taskId,
			signal: controller.signal,
		} as DriverContext)[1].execute as (
			id: string,
			args: { installationId: string; requestId?: string },
		) => Promise<any>;
		const result = await launch("call", { installationId: "rhino", requestId: "launch" });
		expect(result.details.state).toBe("uncertain");
		expect(result.details.nextAction).toContain("ask_user");
		controller.abort();
		expect(
			(await launch("retry", { installationId: "rhino", requestId: "launch" })).content[0].text,
		).toContain("cancelled");
		expect(f.spawns()).toBe(1);
	});
	it("rejects another Mac process through the launch tool", async () => {
		const f = await setup();
		f.registry.register({
			lifecycleInstanceId: "lifecycle",
			processId: 12,
			processStartTime: "start",
			hostEpoch: "epoch",
			attachmentGeneration: "generation",
			capabilities: [],
			documents: [],
			admission: "recovering",
			label: "Rhino",
		});
		f.registry.markReady("lifecycle", {
			authenticated: true,
			generation: "generation",
			operationsIdle: true,
			rhinoScopeIdle: true,
			grasshopperScopeIdle: true,
		});
		await expect(f.launch()).rejects.toThrow("one Rhino process");
		expect(f.spawns()).toBe(0);
	});
	it("reports missing packaged evidence before persisting or spawning", async () => {
		const f = await setup(false);
		await expect(
			f.launch(),
		).rejects.toThrow("not verified");
		expect(f.journal.snapshot().records).toEqual([]);
		expect(f.spawns()).toBe(0);
	});
});

it.each(["darwin", "win32"] as const)(
	"releases only the %s respawn gate after acknowledged empty-process recovery and retains cancelled evidence",
	async (platform) => {
		const f = await setup(true, 10, platform);
		const launch = f.coordinator.tools({
			taskId: f.task.taskId,
		} as DriverContext)[1].execute as (
			id: string,
			args: { installationId: string; requestId?: string },
		) => Promise<unknown>;
		await launch("call", { installationId: "rhino", requestId: "launch" });
		const input = {
			requestId: "recovery",
			taskId: f.task.taskId,
			launchRequestId: "launch",
			acknowledgement:
				"Preserved test model and verified the original Rhino exited",
		};
		await expect(f.coordinator.recoverLaunch(input)).rejects.toThrow("Cancel");
		f.journal.requestCancellation(f.task.taskId);
		await f.coordinator.refresh();
		f.setCandidates([{ pid: 12, startIdentity: "start" }]);
		await expect(f.coordinator.recoverLaunch(input)).rejects.toThrow(
			"still exist",
		);
		f.setCandidates([]);
		const receipt = await f.coordinator.recoverLaunch(input);
		expect(await f.coordinator.recoverLaunch(input)).toEqual(receipt);
		expect(
			f.journal.snapshot().records.find((row) => row.kind === "launch")!.state,
		).toBe("cancelled");
		expect(
			f.journal
				.snapshot()
				.records.filter((row) => row.kind === "launch_recovery"),
		).toHaveLength(1);
		const next = f.journal.accept({
			...f.journal.createConversation("next-conversation", "next"),
			requestId: "next-task",
			kind: "prompt",
			text: "Launch",
			bindings: [],
			attachments: [],
		});
		await expect(
			f.launch("next-launch", next.taskId),
		).resolves.toMatchObject({ details: { state: "uncertain" } });
		expect(f.spawns()).toBe(2);
		const directory = join(f.control.directory, "bootstrap"),
			files = readdirSync(directory);
		const file = files.find(
			(file) =>
				JSON.parse(readFileSync(join(directory, file), "utf8")).requestId ===
				"launch",
		)!;
		const ticket = JSON.parse(readFileSync(join(directory, file), "utf8"));
		const process = { pid: 12, startIdentity: "start" };
		await expect(
			f.coordinator.registered(
				{
					process,
					bootstrap: {
						...ticket,
						ticketId: file.slice(0, -5),
						process,
						lifecycleInstanceId: "late",
					},
				},
				{ lifecycleInstanceId: "late" },
			),
		).rejects.toThrow("no longer authorized");
	},
);

it("cannot recover an empty snapshot while original spawn dispatch is still pending", async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const f = await setup(true, 10, "darwin", gate);
	const launch = f.coordinator.tools({
		taskId: f.task.taskId,
	} as DriverContext)[1].execute as (
		id: string,
		args: { installationId: string; requestId?: string },
	) => Promise<unknown>;
	const pending = launch("call", { installationId: "rhino", requestId: "launch" });
	await vi.waitFor(() => expect(f.spawns()).toBe(1));
	f.journal.requestCancellation(f.task.taskId);
	await f.coordinator.refresh();
	const input = {
		requestId: "recovery",
		taskId: f.task.taskId,
		launchRequestId: "launch",
		acknowledgement: "Inspected startup",
	};
	await expect(f.coordinator.recoverLaunch(input)).rejects.toThrow(
		"still settling",
	);
	expect(
		f.journal.snapshot().records.some((row) => row.kind === "launch_recovery"),
	).toBe(false);
	release();
	await pending;
	const persisted = f.journal
		.snapshot()
		.records.find((row) => row.kind === "launch" && row.id === "launch")!;
	expect(persisted.state).toBe("cancelled");
	expect(JSON.parse(String(persisted.payload)).spawnCandidate).toEqual({
		pid: 12,
		startIdentity: "start",
	});
	const restarted = await createLaunchCoordinator({
		journal: f.journal,
		control: f.control,
		registry: f.registry,
		platform: "darwin",
		installations: [],
		isProcessAlive: (pid) => pid === 12,
		adapter: {
			snapshot: async () => [],
			spawn: async () => {
				throw new Error("must not respawn");
			},
		},
	});
	await expect(restarted.recoverLaunch(input)).rejects.toThrow(
		"candidate PID still exists",
	);
	expect(f.journal.authorizationAdditions(f.task.taskId)).toEqual([]);
	await expect(f.coordinator.recoverLaunch(input)).resolves.toEqual({
		id: "launch",
	});
});

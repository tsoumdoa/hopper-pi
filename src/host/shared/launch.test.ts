import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	JournalLaunchStore,
	LaunchNotStartedError,
	NativeRhinoLaunchAdapter,
	RhinoLaunchService,
	type LaunchAdapter,
	type LaunchRequest,
	type LaunchGrant,
} from "./launch.js";
import { TaskJournal } from "./journal.js";
const journals: TaskJournal[] = [];
const roots: string[] = [];
afterEach(() => {
	journals.splice(0).forEach((journal) => journal.close());
	roots
		.splice(0)
		.forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function setup(
	adapter: LaunchAdapter = {
		snapshot: async () => [],
		spawn: async () => ({ pid: 77, startIdentity: "new" }),
	},
) {
	const root = mkdtempSync(join(tmpdir(), "hopper-launch-"));
	roots.push(root);
	const journal = new TaskJournal(join(root, "journal.sqlite"));
	journals.push(journal);
	const conversation = journal.createConversation(
		"conversation-request",
		"test",
	);
	const receipt = journal.accept({
		...conversation,
		requestId: "root-request",
		kind: "prompt",
		text: "launch",
		bindings: [],
		attachments: [],
	});
	const store = new JournalLaunchStore(journal);
	let ticket: { id: string; nonce: string };
	const intent = {
		desiredState: "running" as "running" | "stopped",
		revision: 1,
	};
	const service = new RhinoLaunchService(
		store,
		adapter,
		{
			create(id, contents) {
				ticket = { id, nonce: contents.nonce };
			},
		},
		() => intent,
		() => 100,
	);
	const request: LaunchRequest = {
		requestId: "request",
		rootTaskId: receipt.taskId,
		installationId: "rhino",
		independentProcess: true,
		intentRevision: 1,
	};
	const grant: LaunchGrant = {
		grantId: "grant",
		rootTaskId: receipt.taskId,
		installationId: "rhino",
		count: 1,
		expiresAt: 1000,
	};
	function registration() {
		return {
			requestId: request.requestId,
			ticketId: ticket.id,
			nonce: ticket.nonce,
			installationId: "rhino",
			process: { pid: 77, startIdentity: "new" },
			lifecycleInstanceId: "lifecycle",
			compatible: true,
		};
	}
	return { service, store, journal, intent, request, grant, registration };
}
describe("durable bounded Rhino launch", () => {
	it("persists intent before spawn, consumes once, and binds only the authenticated lifecycle", async () => {
		const f = setup();
		const first = f.service.grant(f.request, f.grant);
		expect(f.service.grant(f.request, f.grant)).toEqual(first);
		await f.service.start("request");
		f.service.register(f.registration());
		expect(f.service.register(f.registration()).state).toBe(
			"awaiting_document",
		);
		expect(() =>
			f.service.documentReady("request", {
				kind: "rhino",
				lifecycleInstanceId: "other",
				rhinoDocumentId: "model",
			}),
		).toThrow("does not match");
		const complete = f.service.documentReady("request", {
			kind: "rhino",
			lifecycleInstanceId: "lifecycle",
			rhinoDocumentId: "model",
		});
		expect(complete.state).toBe("completed");
		expect(f.store.get("request")!.binding).toEqual(complete.binding);
		expect(f.journal.authorizationAdditions(f.request.rootTaskId)).toEqual([
			complete.binding,
		]);
		expect(
			f.journal.snapshot().records.find((row) => row.kind === "grant")!.state,
		).toBe("consumed");
		expect(() =>
			f.service.grant({ ...f.request, requestId: "other" }, f.grant),
		).toThrow("already consumed");
	});
	it("acknowledges only exact bootstrap retries and never revives cancelled launches", async () => {
		const f = setup();
		f.service.grant(f.request, f.grant);
		await f.service.start("request");
		const registered = f.service.register(f.registration());
		expect(f.service.register(f.registration())).toEqual(registered);
		expect(() =>
			f.service.register({ ...f.registration(), lifecycleInstanceId: "other" }),
		).toThrow("correlation");
		expect(() =>
			f.service.register({ ...f.registration(), nonce: "wrong" }),
		).toThrow("authentication");
		f.journal.requestCancellation(f.request.rootTaskId);
		expect(() => f.service.register(f.registration())).toThrow(
			"no longer authorized",
		);
	});
	it("prevents another first-process grant while the original launcher awaits native registration", async () => {
		const f = setup({ snapshot: async () => [], spawn: async () => undefined });
		const request = { ...f.request, independentProcess: false };
		f.service.grant(request, f.grant);
		await f.service.start(request.requestId);
		expect(() =>
			f.service.grant(
				{ ...request, requestId: "second" },
				{ ...f.grant, grantId: "second" },
			),
		).toThrow("existing first-process launch");
		expect(f.store.all()).toHaveLength(1);
	});
	it("does not replay a spawn after reply loss or restart", async () => {
		let spawns = 0;
		const f = setup({
			snapshot: async () => [],
			spawn: async () => {
				spawns++;
				throw new Error("reply lost");
			},
		});
		f.service.grant(f.request, f.grant);
		expect((await f.service.start("request")).state).toBe("uncertain");
		await f.service.start("request");
		expect(spawns).toBe(1);
		expect(() =>
			f.service.grant(
				{ ...f.request, requestId: "next" },
				{ ...f.grant, grantId: "next" },
			),
		).toThrow("Reconcile");
		expect(f.service.register(f.registration()).state).toBe(
			"awaiting_document",
		);
	});
	it("rejects stale intent, wrong process/nonce, and late cancelled registration", async () => {
		const f = setup();
		f.service.grant(f.request, f.grant);
		await f.service.start("request");
		expect(() =>
			f.service.register({ ...f.registration(), nonce: "wrong" }),
		).toThrow("authentication");
		expect(() =>
			f.service.register({
				...f.registration(),
				process: { pid: 78, startIdentity: "new" },
			}),
		).toThrow("correlation");
		f.intent.desiredState = "stopped";
		expect(() => f.service.register(f.registration())).toThrow("intent");
		f.intent.desiredState = "running";
		f.service.cancel("request");
		expect(() => f.service.register(f.registration())).toThrow(
			"no longer usable",
		);
	});
	it("prevents concurrent start calls and handles cancellation during spawn", async () => {
		let release!: () => void;
		let spawns = 0;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const f = setup({
			snapshot: async () => [],
			spawn: async () => {
				spawns++;
				await pending;
				return undefined;
			},
		});
		f.service.grant(f.request, f.grant);
		const start = f.service.start("request");
		await Promise.resolve();
		await f.service.start("request");
		f.service.cancel("request");
		release();
		expect((await start).state).toBe("cancelled");
		expect(spawns).toBe(1);
		expect(() =>
			f.service.grant(
				{ ...f.request, requestId: "next" },
				{ ...f.grant, grantId: "next" },
			),
		).toThrow("Reconcile");
	});
	it("never accepts a pre-existing process as an independent launch", async () => {
		const f = setup({
			snapshot: async () => [{ pid: 77, startIdentity: "new" }],
			spawn: async () => ({ pid: 77, startIdentity: "new" }),
		});
		f.service.grant(f.request, f.grant);
		expect((await f.service.start("request")).state).toBe("uncertain");
		expect(() => f.service.register(f.registration())).toThrow("correlation");
	});
	it("reloads dispatch evidence from SQLite without replaying after service replacement", async () => {
		let calls = 0;
		const adapter = {
			snapshot: async () => [],
			spawn: async () => {
				calls++;
				return undefined;
			},
		};
		const f = setup(adapter);
		f.service.grant(f.request, f.grant);
		await f.service.start("request");
		const replacement = new RhinoLaunchService(
			new JournalLaunchStore(f.journal),
			adapter,
			{
				create() {
					throw new Error("must retain ticket");
				},
			},
			() => f.intent,
			() => 100,
		);
		expect((await replacement.start("request")).state).toBe(
			"awaiting_registration",
		);
		expect(calls).toBe(1);
		expect(replacement.register(f.registration()).state).toBe(
			"awaiting_document",
		);
	});
	it("reconciles document readiness after a timeout without launching again", async () => {
		const f = setup();
		f.service.grant(f.request, f.grant);
		await f.service.start("request");
		f.service.register(f.registration());
		f.service.timeout("request");
		expect(
			f.service.documentReady("request", {
				kind: "rhino",
				lifecycleInstanceId: "lifecycle",
				rhinoDocumentId: "model",
			}).state,
		).toBe("completed");
		expect(f.journal.authorizationAdditions(f.request.rootTaskId)).toHaveLength(
			1,
		);
	});
	it("checks durable root cancellation even when launch cancellation has not been delivered", async () => {
		const f = setup();
		f.service.grant(f.request, f.grant);
		f.journal.requestCancellation(f.request.rootTaskId);
		await expect(f.service.start("request")).rejects.toThrow(
			"no longer authorized",
		);
	});
	it("records known pre-spawn failures without inventing an uncertain process", async () => {
		const f = setup({
			snapshot: async () => [],
			spawn: async () => {
				throw new LaunchNotStartedError("missing installation");
			},
		});
		f.service.grant(f.request, f.grant);
		expect((await f.service.start("request")).state).toBe("failed");
		expect(
			f.service.grant(
				{ ...f.request, requestId: "next" },
				{ ...f.grant, grantId: "next" },
			).state,
		).toBe("granted");
	});
	it("rejects malformed bindings before committing readiness", async () => {
		const f = setup();
		f.service.grant(f.request, f.grant);
		await f.service.start("request");
		f.service.register(f.registration());
		expect(() =>
			f.service.documentReady("request", {
				kind: "rhino",
				lifecycleInstanceId: "lifecycle",
				rhinoDocumentId: "",
			}),
		).toThrow("Invalid");
		expect(f.store.get("request")!.state).toBe("awaiting_document");
	});
	it("requires packaged evidence before native launch capability is enabled", async () => {
		const adapter = new NativeRhinoLaunchAdapter(
			[
				{
					id: "rhino",
					executable: "/missing",
					platform: "darwin",
					bootstrapVerified: false,
					independentProcessVerified: false,
					bootstrapArguments: (id) => [id],
				},
			],
			async () => [],
		);
		await expect(adapter.spawn("rhino", "a".repeat(64), true)).rejects.toThrow(
			"packaged platform probe",
		);
	});
});

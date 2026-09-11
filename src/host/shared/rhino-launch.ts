import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Type } from "@earendil-works/pi-ai";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TargetBinding } from "../../protocol/shared-execution.js";
import { TaskJournal } from "./journal.js";
import { SharedRegistry } from "./registry.js";
import type { DriverContext } from "./task-service.js";
import { RhinoNotStartedError, windowsRhinoProcess, type RhinoProcessAdapter, type RhinoProcessIdentity } from "./windows-rhino-process.js";

interface LaunchRequest { requestId: string; lifecycleInstanceId?: string }
interface LaunchPayload {
	mechanism: "windows-hopper-code";
	request: LaunchRequest;
	sourceLifecycleInstanceId: string;
	pid?: number;
	process?: RhinoProcessIdentity;
	binding?: TargetBinding;
	error?: string;
}
type Context = Pick<DriverContext, "taskId" | "parentTaskId" | "binding" | "accessibleBindings" | "signal">;
class RhinoLaunchCancelledError extends Error {}

/** Launches have no native edit lease and never change the coordinator's captured document. */
export class RhinoLaunchService {
	private readonly active = new Map<string, Promise<LaunchPayload>>();
	constructor(private readonly journal: TaskJournal, private readonly registry: SharedRegistry,
		private readonly options: { platform?: string; adapter?: RhinoProcessAdapter; timeoutMs?: number; pollMs?: number; allowsLaunch?: () => Promise<boolean> } = {}) {}
	private get adapter() { return this.options.adapter ?? windowsRhinoProcess; }
	get available() { return (this.options.platform ?? process.platform) === "win32"; }
	get pending() { return this.active.size > 0; }
	private records(taskId: string) {
		return this.journal.snapshot({ includeEvents: false }).records.filter(row => row.kind === "launch" && row.task_id === taskId &&
			JSON.parse(String(row.payload)).mechanism === "windows-hopper-code");
	}
	private assertActive(context: Context) {
		const task = this.journal.snapshot({ includeEvents: false }).tasks.find(row => row.id === context.taskId);
		if (context.signal.aborted || task?.cancellation_requested) throw new RhinoLaunchCancelledError("Rhino launch cancelled; an already started Rhino is left open");
		if (!task || task.parent_task_id !== null || context.parentTaskId !== null || task.state !== "running")
			throw new Error("Only a running root task can launch Rhino");
	}
	async launch(context: Context, request: LaunchRequest): Promise<LaunchPayload> {
		if (!this.available) throw new Error("On macOS, use rh_document with action new in the connected process");
		this.assertActive(context);
		if (typeof request.requestId !== "string" || !request.requestId.trim() || request.requestId.length > 128) throw new Error("Supply a stable requestId of at most 128 characters");
		request = { requestId: request.requestId, ...(request.lifecycleInstanceId ? { lifecycleInstanceId: request.lifecycleInstanceId } : {}) };
		const id = "rhino-launch-" + createHash("sha256").update(`${context.taskId}:${request.requestId}`).digest("hex").slice(0, 32);
		const prior = this.records(context.taskId).find(row => row.id === id);
		if (prior) {
			const payload = JSON.parse(String(prior.payload)) as LaunchPayload;
			if (payload.request.lifecycleInstanceId !== request.lifecycleInstanceId) throw new Error("Launch requestId conflicts with its original source");
			if (this.active.has(id)) return this.active.get(id)!;
			if (prior.state === "completed") {
				this.registry.resolveBinding(payload.binding!);
				return payload;
			}
			if (!["dispatched", "uncertain"].includes(String(prior.state)))
				throw new Error(payload.error ?? "Launch did not complete; inspect its recorded outcome");
			// Retry observes the original process; it never spawns again.
			return this.track(id, () => this.waitForReady(context, id, payload));
		}
		if (this.records(context.taskId).some(row => ["accepted", "dispatched", "uncertain"].includes(String(row.state))))
			throw new Error("A Rhino launch is unresolved. Retry its original requestId to inspect readiness; do not launch a replacement");
		const bindings = [...(context.accessibleBindings ?? []), ...(context.binding ? [context.binding] : []), ...this.journal.authorizationAdditions(context.taskId)];
		const lifecycles = new Set(bindings.map(binding => binding.lifecycleInstanceId));
		const sourceId = request.lifecycleInstanceId ?? context.binding?.lifecycleInstanceId ?? (lifecycles.size === 1 ? [...lifecycles][0] : undefined);
		if (!sourceId || !lifecycles.has(sourceId)) throw new Error("Choose an accessible connected source from listRhinoTargets using lifecycleInstanceId");
		this.registry.resolveLifecycle(sourceId);
		const source = this.registry.list().find(item => item.lifecycleInstanceId === sourceId)!;
		const payload: LaunchPayload = { mechanism: "windows-hopper-code", request, sourceLifecycleInstanceId: sourceId };
		this.journal.putRecord(id, "launch", id, context.taskId, payload);
		return this.track(id, async () => {
			try {
				const installation = await this.adapter.inspect(source.processId);
				if (!installation || installation.startIdentity !== source.processStartTime) throw new RhinoNotStartedError("Source Rhino process exited or changed");
				this.assertActive(context);
				if (this.options.allowsLaunch && !await this.options.allowsLaunch()) throw new RhinoNotStartedError("Host is stopping; launch cancelled");
				this.assertActive(context);
				this.update(id, "dispatched", payload);
				payload.process = await this.adapter.spawn(installation.executable, pid => {
					payload.pid = pid;
					this.update(id, "dispatched", payload);
				});
				if (payload.process.pid !== payload.pid || payload.process.pid === source.processId || payload.process.executable.toLowerCase() !== installation.executable.toLowerCase())
					throw new Error("Launcher did not produce a new process from the selected Rhino installation");
				this.update(id, "dispatched", payload);
			} catch (error) {
				const row = this.records(context.taskId).find(row => row.id === id)!;
				this.update(id, context.signal.aborted || error instanceof RhinoLaunchCancelledError ? "cancelled" : row.state === "accepted" || error instanceof RhinoNotStartedError ? "failed" : "uncertain", { ...payload, error: String(error) });
				throw error;
			}
			return this.waitForReady(context, id, payload);
		});
	}
	private track(id: string, work: () => Promise<LaunchPayload>): Promise<LaunchPayload> {
		const promise = work().finally(() => this.active.delete(id));
		this.active.set(id, promise);
		return promise;
	}
	private update(id: string, state: string, payload: LaunchPayload) {
		const row = this.journal.snapshot({ includeEvents: false }).records.find(row => row.kind === "launch" && row.id === id)!;
		this.journal.transitionRecord("launch", id, String(row.state), state, payload);
	}
	private async waitForReady(context: Context, id: string, payload: LaunchPayload): Promise<LaunchPayload> {
		const deadline = Date.now() + (this.options.timeoutMs ?? 120_000);
		try {
			if (!payload.process) throw new Error("Launch process identity was not confirmed; inspect Rhino before attempting another launch");
			while (true) {
				this.assertActive(context);
				const current = await this.adapter.inspect(payload.process.pid);
				this.assertActive(context);
				if (!current || current.startIdentity !== payload.process.startIdentity) {
					this.update(id, "failed", { ...payload, error: "Launched Rhino exited before becoming ready" });
					throw new RhinoNotStartedError("Launched Rhino exited before becoming ready");
				}
				const attachment = this.registry.list().find(item => item.processId === current.pid && item.processStartTime === current.startIdentity && item.admission === "ready");
				const documents = attachment?.documents.filter(binding => binding.kind === "rhino") ?? [];
				if (documents.length === 1) {
					const result = { ...payload, binding: documents[0]! };
					delete result.error;
					this.registry.resolveBinding(result.binding);
					this.journal.completeRhinoLaunch(id, result.binding, result);
					return result;
				}
				if (Date.now() >= deadline) throw new Error("Rhino startup timed out. Inspect startup or licensing dialogs, then retry the same requestId; no replacement was launched");
				await delay(this.options.pollMs ?? 1_000, undefined, { signal: context.signal });
			}
		} catch (error) {
			if (!(error instanceof RhinoNotStartedError)) this.update(id, context.signal.aborted || error instanceof RhinoLaunchCancelledError ? "cancelled" : "uncertain", { ...payload, error: String(error) });
			throw error;
		}
	}
	tools(context: DriverContext): ToolDefinition[] {
		if (!this.available || context.parentTaskId !== null) return [];
		return [{ name: "launchRhino", label: "Launch Rhino instance",
			description: "Launch an additional Windows Rhino using an accessible connected instance's installation. Starts a blank default model and HopperCode, waits for readiness, and returns a binding for delegate. Preserves your selected document. Reuse requestId to check a timed-out launch; never issue a replacement request while it is unresolved.",
			parameters: Type.Object({ requestId: Type.String({ minLength: 1, maxLength: 128 }), lifecycleInstanceId: Type.Optional(Type.String()) }),
			execute: async (_id, raw) => {
				try { const result = await this.launch(context, raw as LaunchRequest); return { content: [{ type: "text", text: JSON.stringify(result) }], details: result }; }
				catch (error) { return { isError: true, content: [{ type: "text", text: String(error) }], details: {} }; }
			},
		}];
	}
}

import type { HostRuntime } from "../pi-runtime.js";
import type { AgentToolsSnapshot, ToolSettingsAction } from "../protocol.js";
import { validateTargetBinding, type TargetBinding } from "../../protocol/shared-execution.js";
import type { SharedTaskService } from "./task-service.js";

/** Saved choices are profile-wide; availability and exposure belong to the requested target/task. */
export function sharedToolSettings(query: URLSearchParams, options: {
	admin: Pick<HostRuntime, "getToolSettings" | "updateToolSettings">;
	tasks: Pick<SharedTaskService, "toolSettings">;
	checkConnection(binding: TargetBinding): Promise<boolean>;
}): Pick<HostRuntime, "getToolSettings" | "updateToolSettings"> {
	const conversationId = query.get("conversationId") ?? "";
	const taskId = query.get("taskId") ?? "";
	const rawTarget = query.get("target");
	const target = rawTarget ? JSON.parse(rawTarget) as TargetBinding : null;
	if (target && !validateTargetBinding(target).ok) throw new Error("Invalid tool target");
	const task = () => conversationId && taskId ? options.tasks.toolSettings(conversationId, taskId) : undefined;
	const inTask = (snapshot: AgentToolsSnapshot): AgentToolsSnapshot => ({ ...snapshot, context: { kind: "task", taskId, label: "Tools in the running conversation task" } });
	const preview = async (): Promise<AgentToolsSnapshot> => {
		const online = target ? await options.checkConnection(target) : false;
		const snapshot = await options.admin.getToolSettings(online);
		return {
			...snapshot,
			context: { kind: "target", label: target
				? "Availability for the selected target. No task is running."
				: "Select a Rhino target to check native tool availability." },
		};
	};
	return {
		getToolSettings: async () => {
			const current = task();
			return current ? inTask(await current.getToolSettings()) : preview();
		},
		updateToolSettings: async (action: ToolSettingsAction) => {
			const current = task();
			if (current) {
				const result = await current.updateToolSettings(action);
				return { ...result, snapshot: inTask(result.snapshot) };
			}
			if (action.type === "activate") return {
				ok: false, code: "error", error: "There is no running task to activate this tool for.", snapshot: await preview(),
			};
			if (action.type === "check-connection") return { ok: true, snapshot: await preview() };
			const result = await options.admin.updateToolSettings(action);
			return { ...result, snapshot: await preview() };
		},
	};
}

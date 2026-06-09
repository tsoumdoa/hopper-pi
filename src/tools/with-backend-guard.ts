import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { backendOfflineToolResult } from "../infra/backend-status-cache.js";
import { refreshBackendIfOffline } from "../infra/backend-status.js";

/** Wrap a tool so it returns immediately when the backend is known offline. */
export function withBackendGuard<T extends ToolDefinition>(tool: T): T {
	const { execute } = tool;
	return {
		...tool,
		async execute(...args) {
			if (!(await refreshBackendIfOffline())) {
				return backendOfflineToolResult();
			}
			return execute(...args);
		},
	};
}

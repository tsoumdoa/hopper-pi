import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	backendOfflineToolResult,
	isBackendKnownOffline,
} from "../infra/backend-status-cache.js";

/** Wrap a tool so it returns immediately when the backend is known offline. */
export function withBackendGuard<T extends ToolDefinition>(tool: T): T {
	const { execute } = tool;
	return {
		...tool,
		async execute(...args) {
			if (isBackendKnownOffline()) {
				return backendOfflineToolResult();
			}
			return execute(...args);
		},
	};
}

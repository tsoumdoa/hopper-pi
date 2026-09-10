/**
 * Hopper Pi — Grasshopper Canvas Tools Extension for Pi
 *
 * This extension gives the AI agent direct access to inspect and edit
 * a Grasshopper canvas running in Rhino via ZeroMQ.
 *
 * Architecture:
 *   - infra/        → ZMQ transport (REQ/REP, PUSH, SUB sockets)
 *   - types/        → Message & domain schemas
 *   - services/     → XML parser (Grasshopper archive → JSON)
 *   - tools/        → Pi extension tool definitions (rh_run_script + GH tools)
 *
 * Backend ports (configurable via env vars):
 *   - PUB  :5555  (event publishing)
 *   - PUSH :5556  (command submission)
 *   - REQ  :5557  (query/response)
 */

import { RuntimeSessionContext } from "./infra/runtime-session-context.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	beginRuntimeAgentTurn,
	cancelRuntimeAgentTurn,
	commitRuntimeAgentTurn,
} from "./infra/runtime-rpc.js";
import { registerBackendStatusUI } from "./ui/backend-status.js";
import { registerToolSchemasUI } from "./ui/tool-schemas.js";
import {
	HOPPER_REGISTERED_CATALOG,
	RH_CAPTURE_VIEW_CATALOG_ENTRY,
	type HopperToolCatalogEntry,
} from "./tools/index.js";
import {
	createHopperSearchToolsTool,
} from "./tools/hopper-search-tools.js";
import { ENV, isProgressiveToolsEnvEnabled } from "./config.js";
import {
	createRhinoCaptureModelController,
	promptWantsVisualCapture,
} from "./services/rhino-capture-model.js";
import { promptTargetsRhino } from "./services/prompt-routing.js";

import { RhinoScriptWorkspace } from "./services/rhino-script-workspace.js";
import { RhinoScriptExecution } from "./services/rhino-script-execution.js";
import {
	createRhScriptTool,
	type ScriptToolContext,
} from "./tools/rh-script.js";
import { createRhRunScriptTool } from "./tools/rh-run-script.js";
import { ToolPolicyRuntime } from "./services/tool-policy-runtime.js";
import { registerToolControlsCommand } from "./ui/tool-controls.js";

export type HopperExtensionOptions = {
	toolPolicy?: ToolPolicyRuntime;
	runtimeSession?: RuntimeSessionContext;
	runTool?<T>(name: string, work: () => Promise<T>): Promise<T>;
	scriptWorkspaceDir?: string;
	scriptWorkspaceQuotaBytes?: number;
	sessionId?: () => string;
};
export function createHopperPiExtension(options: HopperExtensionOptions = {}) {
	return (pi: ExtensionAPI) => registerHopperPiExtension(
		options.runtimeSession ? withRuntimeSession(pi, options.runtimeSession, options.runTool) : pi, options,
	);
}
/** Bind every hook and tool, including tools registered later by model selection. */
function withRuntimeSession(pi: ExtensionAPI, session: RuntimeSessionContext, runTool?: HopperExtensionOptions["runTool"]): ExtensionAPI {
	return new Proxy(pi, {
		get(target, property) {
			if (property === "on") {
				return (event: string, handler: (...args: unknown[]) => unknown) =>
					Reflect.apply(target.on, target, [event, (...args: unknown[]) => session.run(() => handler(...args))]);
			}
			if (property === "registerCommand") {
				return (name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) => target.registerCommand(name, {
					...command,
					handler: (...args) => session.run(() => command.handler(...args)),
				});
			}
			if (property === "registerTool") {
				return (tool: Parameters<ExtensionAPI["registerTool"]>[0]) => target.registerTool({
					...tool,
					execute: (...args) => {
						const work = async () => session.run(() => tool.execute(...args));
						return runTool && tool.name !== "hopper_search_tools" ? runTool(tool.name, work) : work();
					},
				});
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

const PROGRESSIVE_TOOLS_FLAG = "hopper-progressive-tools";

function isProgressiveToolsEnabled(pi: ExtensionAPI): boolean {
	const flag = pi.getFlag(PROGRESSIVE_TOOLS_FLAG);
	if (typeof flag === "boolean") return flag;
	return isProgressiveToolsEnvEnabled();
}

export default function hopperPiExtension(pi: ExtensionAPI) {
	return registerHopperPiExtension(pi, {});
}
function registerHopperPiExtension(
	pi: ExtensionAPI,
	options: HopperExtensionOptions,
) {
	pi.registerFlag("hopper-config-dir", { type: "string", description: "Absolute Hopper tool settings profile directory" });
	const policy = options.toolPolicy ?? new ToolPolicyRuntime();
	let profileConfigured = false;

	registerToolControlsCommand(pi, policy);
	let scriptContext: ScriptToolContext | undefined;
	const bindWorkspace = (directory: string, sessionId: string) => {
		const workspace = new RhinoScriptWorkspace(
			options.scriptWorkspaceDir ??
				process.env.HOPPER_SCRIPT_WORKSPACE ??
				directory,
			options.scriptWorkspaceQuotaBytes ??
				(process.env.HOPPER_SCRIPT_WORKSPACE_QUOTA_BYTES
					? Number(process.env.HOPPER_SCRIPT_WORKSPACE_QUOTA_BYTES)
					: undefined),
		);
		scriptContext = {
			workspace,
			execution: new RhinoScriptExecution(workspace),
			sessionId,
		};
	};
	const getScriptContext = () => {
		if (!scriptContext) {
			if (!options.sessionId)
				throw new Error(
					"Script workspace is not bound to a persistent session yet",
				);
			bindWorkspace(process.cwd(), options.sessionId());
		}
		return scriptContext!;
	};
	const registeredCatalog = HOPPER_REGISTERED_CATALOG.map((entry) => ({
		...entry,
		tool:
			entry.tool.name === "rh_script"
				? createRhScriptTool(getScriptContext)
				: entry.tool.name === "rh_run_script"
					? createRhRunScriptTool(getScriptContext)
					: entry.tool,
	}));
	pi.registerFlag(PROGRESSIVE_TOOLS_FLAG, {
		type: "boolean",
		default: isProgressiveToolsEnvEnabled(),
		description:
			"Start with a small Hopper core and activate specialists via hopper_search_tools. " +
			`Off by default (all Hopper tools active). Also set ${ENV.HOPPER_PROGRESSIVE_TOOLS}=1.`,
	});

	// ── Register Grasshopper/Rhino tools + progressive loader ───────

	let catalog: readonly HopperToolCatalogEntry[] = registeredCatalog;
	const getCatalog = () => catalog;
	const searchTool = createHopperSearchToolsTool(pi, getCatalog, policy);

	catalog = [
		...registeredCatalog,
		{
			tool: searchTool,
			group: "interaction",
			keywords: ["search tools", "activate", "discover"],
			alwaysActive: true,
		},
		RH_CAPTURE_VIEW_CATALOG_ENTRY,
		...policy.pluginCatalog,
	];

	registerBackendStatusUI(pi);
	registerToolSchemasUI(pi, getCatalog);

	const captureModel = createRhinoCaptureModelController(pi);

	// ── Lifecycle: notify on load ──────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		if (!profileConfigured && !options.toolPolicy) {
			const configured = pi.getFlag("hopper-config-dir");
			if (typeof configured === "string") policy.configureDirectory(configured);
			profileConfigured = true;
		}
		if (ctx.sessionManager) bindWorkspace(ctx.cwd, ctx.sessionManager.getSessionId());
		policy.bind(pi, ctx, isProgressiveToolsEnabled(pi));
		for (const entry of registeredCatalog) {
			policy.register(pi, entry.tool);
		}
		policy.register(pi, searchTool);
		policy.register(pi, RH_CAPTURE_VIEW_CATALOG_ENTRY.tool);
		policy.registerPlugins(pi);
		await policy.reconcile();
	});

	pi.on("turn_end", async (_event, ctx) => {
		policy.setContext(ctx);
		await policy.reconcile(true);
	});
	pi.on("session_compact", async (_event, ctx) => { policy.setContext(ctx); await policy.reconcile(true); });
	pi.on("session_compact_failed", async (_event, ctx) => { policy.setContext(ctx); await policy.reconcile(true); });

	pi.on("before_agent_start", async (event, ctx) => {
		policy.setBusy(true);
		policy.setContext(ctx);
		await policy.reconcile(true);
		if (promptTargetsRhino(event.prompt ?? "") && promptWantsVisualCapture(event.prompt ?? "")
			&& (await policy.allowedToolNames()).has("rh_capture_view")) {
			await captureModel.maybeSwitchToMultimodalFallback(ctx);
			await policy.reconcile(true);
		}
		// Let Pi rebuild its prompt from the current tool list at every boundary.
		// A systemPrompt override here would freeze stale tool/skill guidance for the turn.
	});

	pi.on("model_select", async (event, ctx) => {
		policy.setContext({ ...ctx, model: event.model });
		if (!policy.isBusy()) await policy.reconcile();
	});

	// Owned-child sessions keep a prompt-wide undo segment. Shared task tools
	// finish their own segments before releasing the process to another agent.

	pi.on("agent_start", () => {
		policy.setBusy(true);
		beginRuntimeAgentTurn();
	});

	pi.on("agent_end", async (event) => {
		if ("willRetry" in event && event.willRetry) {
			return;
		}
		await commitRuntimeAgentTurn();
		policy.setBusy(false);
		await policy.reconcile();
	});

	pi.on("session_shutdown", async () => {
		await policy.close();
		await cancelRuntimeAgentTurn();
	});
}

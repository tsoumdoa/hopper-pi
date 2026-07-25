/** Central configuration for the Pi extension. */

export const ENV = {
	GH_DEBUG: "GH_DEBUG",
	GH_ZMQ_PUB: "GH_ZMQ_PUB",
	GH_ZMQ_PUSH: "GH_ZMQ_PUSH",
	GH_ZMQ_REQ: "GH_ZMQ_REQ",
	GH_ZMQ_TOKEN: "GH_ZMQ_TOKEN",
	HOPPER_CONNECTION_PROFILE: "HOPPER_CONNECTION_PROFILE",
	HOPPER_MULTIMODAL_FALLBACK: "HOPPER_MULTIMODAL_FALLBACK",
	HOPPER_RHINO_CAPTURE_CONSENT: "HOPPER_RHINO_CAPTURE_CONSENT",
	/** Opt-in progressive tool loading (`1`/`true`/`on`/`yes`). Default off restores all-tools-active. */
	HOPPER_PROGRESSIVE_TOOLS: "HOPPER_PROGRESSIVE_TOOLS",
	/** Max tools hopper_search_tools may activate per request (default 5, clamped 1–12). */
	HOPPER_SEARCH_TOOL_LIMIT: "HOPPER_SEARCH_TOOL_LIMIT",
} as const;

export const DEFAULT_ZMQ_ENDPOINTS = {
	pub: "tcp://127.0.0.1:5555",
	push: "tcp://127.0.0.1:5556",
	req: "tcp://127.0.0.1:5557",
} as const;

export const PROBE_TIMEOUT_MS = 8_000;
export const BACKEND_POLL_INTERVAL_MS = 3_000;
export const MAX_RHINO_OBJECT_IDS = 30;

export const DEBUG = process.env[ENV.GH_DEBUG] === "1";
export const MULTIMODAL_FALLBACK_MODEL = process.env[ENV.HOPPER_MULTIMODAL_FALLBACK]?.trim() || "";

const TRUTHY = new Set(["1", "true", "yes", "y", "on"]);

function envTruthy(name: string): boolean {
	const raw = process.env[name]?.trim().toLowerCase();
	return raw != null && TRUTHY.has(raw);
}

/** Progressive core + hopper_search_tools. Off by default (issue #27 MVP). */
export const PROGRESSIVE_TOOLS_ENABLED = envTruthy(ENV.HOPPER_PROGRESSIVE_TOOLS);

const DEFAULT_SEARCH_TOOL_LIMIT = 5;
const MIN_SEARCH_TOOL_LIMIT = 1;
const MAX_SEARCH_TOOL_LIMIT = 12;

function parseSearchToolLimit(raw: string | undefined): number {
	if (!raw?.trim()) return DEFAULT_SEARCH_TOOL_LIMIT;
	const n = Number.parseInt(raw.trim(), 10);
	if (!Number.isFinite(n)) return DEFAULT_SEARCH_TOOL_LIMIT;
	return Math.min(MAX_SEARCH_TOOL_LIMIT, Math.max(MIN_SEARCH_TOOL_LIMIT, n));
}

export const SEARCH_TOOL_LIMIT = parseSearchToolLimit(process.env[ENV.HOPPER_SEARCH_TOOL_LIMIT]);

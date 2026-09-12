/** Central configuration for the Pi extension. */

export const ENV = {
	HOPPER_CONNECTION_PROFILE: "HOPPER_CONNECTION_PROFILE",
	HOPPER_MULTIMODAL_FALLBACK: "HOPPER_MULTIMODAL_FALLBACK",
	/** When enabled (`1`/`true`/`yes`/`on`), start with a small Hopper core and load specialists via hopper_search_tools. Off by default (today's all-tools-active behavior). */
	HOPPER_PROGRESSIVE_TOOLS: "HOPPER_PROGRESSIVE_TOOLS",
} as const;

export const PROBE_TIMEOUT_MS = 8_000;
export const BACKEND_POLL_INTERVAL_MS = 3_000;
export const MAX_RHINO_OBJECT_IDS = 30;

const ENV_FLAG_ON = new Set(["1", "true", "yes", "y", "on"]);
const ENV_FLAG_OFF = new Set(["0", "false", "no", "n", "off"]);

export const MULTIMODAL_FALLBACK_MODEL = process.env[ENV.HOPPER_MULTIMODAL_FALLBACK]?.trim() || "";

/** Parse a boolean-ish env flag; returns undefined when unset/unrecognized. */
export function readEnvBoolFlag(name: string): boolean | undefined {
	const raw = process.env[name]?.trim().toLowerCase();
	if (!raw) return undefined;
	if (ENV_FLAG_ON.has(raw)) return true;
	if (ENV_FLAG_OFF.has(raw)) return false;
	return undefined;
}

/**
 * Progressive Hopper tool loading (small always-on core + hopper_search_tools).
 * Default false — restores today's all-tools-active behavior unless opted in.
 */
export function isProgressiveToolsEnvEnabled(): boolean {
	return readEnvBoolFlag(ENV.HOPPER_PROGRESSIVE_TOOLS) === true;
}

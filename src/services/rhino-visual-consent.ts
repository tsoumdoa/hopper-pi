import { ENV } from "../config.js";

export type RhinoVisualCaptureConsent = "unknown" | "allowed" | "denied";

export const VISUAL_CAPTURE_DENY_LABEL = "No, work without visual capture for this Pi session";
export const VISUAL_CAPTURE_ALLOW_SESSION_LABEL = "Yes, allow screenshots for this Pi session";
export const VISUAL_CAPTURE_ENV_VAR = ENV.HOPPER_RHINO_CAPTURE_CONSENT;

const ALLOW_VALUES = new Set(["1", "true", "yes", "y", "allow", "allowed", "always", "on"]);
const DENY_VALUES = new Set(["0", "false", "no", "n", "deny", "denied", "never", "off"]);

let visualCaptureConsent: RhinoVisualCaptureConsent = "unknown";

export function getRhinoVisualCaptureEnvOverride(): RhinoVisualCaptureConsent {
	const raw = process.env[VISUAL_CAPTURE_ENV_VAR]?.trim().toLowerCase();
	if (!raw) return "unknown";
	if (ALLOW_VALUES.has(raw)) return "allowed";
	if (DENY_VALUES.has(raw)) return "denied";
	return "unknown";
}

export function isRhinoVisualCaptureOverrideConfigured(): boolean {
	return getRhinoVisualCaptureEnvOverride() !== "unknown";
}

export function getRhinoVisualCaptureConsent(): RhinoVisualCaptureConsent {
	const override = getRhinoVisualCaptureEnvOverride();
	return override === "unknown" ? visualCaptureConsent : override;
}

export function hasRhinoVisualCaptureDecision(): boolean {
	return getRhinoVisualCaptureConsent() !== "unknown";
}

export function isRhinoVisualCaptureAllowed(): boolean {
	return getRhinoVisualCaptureConsent() === "allowed";
}

export function setRhinoVisualCaptureConsent(allowed: boolean): void {
	visualCaptureConsent = allowed ? "allowed" : "denied";
}

export function resetRhinoVisualCaptureState(): void {
	visualCaptureConsent = "unknown";
}

export function rhinoVisualCaptureGuidance(): string {
	if (isRhinoVisualCaptureAllowed()) {
		const suffix = isRhinoVisualCaptureOverrideConfigured()
			? ` (${VISUAL_CAPTURE_ENV_VAR}=allow override is active).`
			: ".";
		return `Rhino viewport screenshots are allowed for this Pi session${suffix} Use rh_capture_view only when visual context would materially help.`;
	}

	const overrideText = isRhinoVisualCaptureOverrideConfigured()
		? ` ${VISUAL_CAPTURE_ENV_VAR}=deny is active; change it to allow and restart Pi to enable screenshots.`
		: ` To enable later, explicitly ask to allow Rhino screenshots for this session, or set ${VISUAL_CAPTURE_ENV_VAR}=allow before starting Pi.`;
	return `Rhino viewport screenshots are not allowed for this Pi session.${overrideText} Work without visual capture; use rh_query_objects, gh_get_canvas, gh_get_canvas_errors, and rh_run_script for text/geometry context.`;
}

export type RhinoVisualCaptureConsent = "unknown" | "allowed" | "denied";

export const VISUAL_CAPTURE_DENY_LABEL = "No, work without visual capture for this Pi session";
export const VISUAL_CAPTURE_ALLOW_SESSION_LABEL = "Yes, allow screenshots for this Pi session";

let visualCaptureConsent: RhinoVisualCaptureConsent = "unknown";

export function getRhinoVisualCaptureConsent(): RhinoVisualCaptureConsent {
	return visualCaptureConsent;
}

export function hasRhinoVisualCaptureDecision(): boolean {
	return visualCaptureConsent !== "unknown";
}

export function isRhinoVisualCaptureAllowed(): boolean {
	return visualCaptureConsent === "allowed";
}

export function setRhinoVisualCaptureConsent(allowed: boolean): void {
	visualCaptureConsent = allowed ? "allowed" : "denied";
}

export function resetRhinoVisualCaptureState(): void {
	visualCaptureConsent = "unknown";
}

export function rhinoVisualCaptureGuidance(): string {
	return isRhinoVisualCaptureAllowed()
		? "Rhino viewport screenshots are allowed for this Pi session. Use rh_capture_view only when visual context would materially help."
		: "Rhino viewport screenshots are not allowed for this Pi session. Work without visual capture; use rh_query_objects, gh_get_canvas, gh_get_canvas_errors, and rh_run_script for text/geometry context.";
}

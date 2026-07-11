const RHINO_CONTEXT_RE =
	/(?:^|[^\w])(?:rhino(?:doc(?:ument)?)?|rhinoscript|scriptcontext|rh_(?:run_script|query_objects|view_control|capture_view)|viewports?|cplanes?|construction\s+planes?|named\s+views?|_(?:circle|line|extrude|sellayer|zoom|layer))(?=[^\w]|$)/i;

const GRASSHOPPER_CONTEXT_RE =
	/(?:^|[^\w])(?:grasshopper|gh\s+(?:definition|canvas|components?|wires?|sliders?|scripts?|params?)|gh_(?:get|list|edit|create|mutate|param)[a-z_]*)(?=[^\w]|$)/i;

/** Require an explicit Rhino-domain anchor before injecting Rhino routing or capture consent. */
export function promptTargetsRhino(prompt: string): boolean {
	return RHINO_CONTEXT_RE.test(prompt);
}

/** Detect explicit Grasshopper context without treating generic “component” or “canvas” as GH. */
export function promptTargetsGrasshopper(prompt: string): boolean {
	return GRASSHOPPER_CONTEXT_RE.test(prompt);
}

export function rhinoRoutingGuidance(includesGrasshopper: boolean): string {
	if (includesGrasshopper) {
		return (
			"Hopper routing for this request: use rh_run_script for Rhino document changes, " +
			"rh_view_control for normal viewport/camera changes, and gh_* tools for Grasshopper canvas changes."
		);
	}

	return (
		"Hopper routing for this request: use rh_run_script for Rhino document changes and " +
		"rh_view_control for normal viewport/camera changes. Do not use gh_edit_* unless the request also changes Grasshopper."
	);
}

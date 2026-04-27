export type PropertyChange = {
	path: string;
	old: unknown;
	new: unknown;
};

export type ComponentDiff = {
	id: string;
	type: string;
	added: string[];
	removed: string[];
	changed: PropertyChange[];
};

export type WireDiff = {
	added: import("./gh.js").Wire[];
	removed: import("./gh.js").Wire[];
};

export type GhDiff = {
	addedComponents: Array<{ id: string; type: string }>;
	removedComponents: Array<{ id: string; type: string }>;
	components: ComponentDiff[];
	wires: WireDiff;
};

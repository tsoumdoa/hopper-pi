import type { ParsedGrasshopper, Component, Wire, InputPort, OutputPort, PortOptions, ComponentValue } from "../types/gh.js";
import type { PropertyChange, ComponentDiff, WireDiff, GhDiff } from "../types/diff.js";

const SKIP_COMPONENT_KEYS = new Set(["id", "guid", "visuals"]);
const SKIP_PORT_KEYS = new Set(["guid"]);

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return a === b;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;

	const aObj = a as Record<string, unknown>;
	const bObj = b as Record<string, unknown>;
	const aKeys = Object.keys(aObj);
	const bKeys = Object.keys(bObj);

	if (aKeys.length !== bKeys.length) return false;

	for (const key of aKeys) {
		if (!bKeys.includes(key)) return false;
		if (!deepEqual(aObj[key], bObj[key])) return false;
	}

	return true;
}

function formatValue(val: unknown): string {
	if (val == null) return "null";
	if (typeof val === "string") return val.length > 60 ? val.slice(0, 57) + "..." : val;
	if (typeof val === "object") return JSON.stringify(val);
	return String(val);
}

function diffPorts(
	prev: Record<string, InputPort | OutputPort>,
	next: Record<string, InputPort | OutputPort>,
	parentPath: string,
	changes: PropertyChange[]
): void {
	const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);

	for (const key of allKeys) {
		const p = prev[key];
		const n = next[key];
		const path = `${parentPath}.${key}`;

		if (p && !n) {
			changes.push({ path, old: formatValue(p.nick), new: "(removed)" });
			continue;
		}
		if (!p && n) {
			changes.push({ path, old: "(added)", new: formatValue(n.nick) });
			continue;
		}

		const allSubKeys = new Set([...Object.keys(p), ...Object.keys(n)]);
		for (const subKey of allSubKeys) {
			if (SKIP_PORT_KEYS.has(subKey)) continue;
			const pv = (p as unknown as Record<string, unknown>)[subKey];
			const nv = (n as unknown as Record<string, unknown>)[subKey];
			if (deepEqual(pv, nv)) continue;

			const subPath = `${path}.${subKey}`;

			if (subKey === "options") {
				diffPortOptions(pv as PortOptions | undefined, nv as PortOptions | undefined, subPath, changes);
			} else {
				changes.push({ path: subPath, old: formatValue(pv), new: formatValue(nv) });
			}
		}
	}
}

function diffPortOptions(
	prev: PortOptions | undefined,
	next: PortOptions | undefined,
	path: string,
	changes: PropertyChange[]
): void {
	if (!prev && !next) return;
	const allKeys = new Set([...(prev ? Object.keys(prev) : []), ...(next ? Object.keys(next) : [])]);
	for (const key of allKeys) {
		const pv = prev?.[key as keyof PortOptions];
		const nv = next?.[key as keyof PortOptions];
		if (deepEqual(pv, nv)) continue;
		changes.push({ path: `${path}.${key}`, old: formatValue(pv), new: formatValue(nv) });
	}
}

function diffValue(
	prev: ComponentValue | undefined,
	next: ComponentValue | undefined,
	path: string,
	changes: PropertyChange[]
): void {
	if (!prev && !next) return;
	if (!prev) {
		changes.push({ path, old: "(added)", new: formatValue(next) });
		return;
	}
	if (!next) {
		changes.push({ path, old: formatValue(prev), new: "(removed)" });
		return;
	}

	const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
	for (const key of allKeys) {
		const pv = (prev as unknown as Record<string, unknown>)[key];
		const nv = (next as unknown as Record<string, unknown>)[key];
		if (deepEqual(pv, nv)) continue;
		changes.push({ path: `${path}.${key}`, old: formatValue(pv), new: formatValue(nv) });
	}
}

function diffComponent(prev: Component, next: Component): ComponentDiff {
	const added: string[] = [];
	const removed: string[] = [];
	const changed: PropertyChange[] = [];

	const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);

	for (const key of allKeys) {
		if (SKIP_COMPONENT_KEYS.has(key)) continue;
		const pv = (prev as unknown as Record<string, unknown>)[key];
		const nv = (next as unknown as Record<string, unknown>)[key];

		if (pv === undefined && nv !== undefined) {
			added.push(key);
			continue;
		}
		if (pv !== undefined && nv === undefined) {
			removed.push(key);
			continue;
		}
		if (deepEqual(pv, nv)) continue;

		switch (key) {
			case "inputs":
				diffPorts(
					prev.inputs as Record<string, InputPort>,
					next.inputs as Record<string, InputPort>,
					"inputs",
					changed
				);
				break;
			case "outputs":
				diffPorts(
					prev.outputs as Record<string, OutputPort>,
					next.outputs as Record<string, OutputPort>,
					"outputs",
					changed
				);
				break;
			case "value":
				diffValue(prev.value, next.value, "value", changed);
				break;
			case "members": {
				const pm = new Set(prev.members ?? []);
				const nm = new Set(next.members ?? []);
				const addedMembers = [...nm].filter((m) => !pm.has(m));
				const removedMembers = [...pm].filter((m) => !nm.has(m));
				if (addedMembers.length > 0) {
					changed.push({ path: "members", old: "(none)", new: addedMembers.join(", ") });
				}
				if (removedMembers.length > 0) {
					changed.push({ path: "members", old: removedMembers.join(", "), new: "(none)" });
				}
				break;
			}
			case "script": {
				if (prev.script && next.script) {
				const allScriptKeys = new Set([...Object.keys(prev.script), ...Object.keys(next.script)]);
				for (const sk of allScriptKeys) {
					const spv = (prev.script as unknown as Record<string, unknown>)[sk];
					const snv = (next.script as unknown as Record<string, unknown>)[sk];
						if (deepEqual(spv, snv)) continue;
						if (sk === "code") {
							const oldCode = String(spv);
							const newCode = String(snv);
							if (oldCode !== newCode) {
								changed.push({
									path: "script.code",
									old: `${oldCode.length} chars`,
									new: `${newCode.length} chars`,
								});
							}
						} else {
							changed.push({ path: `script.${sk}`, old: formatValue(spv), new: formatValue(snv) });
						}
					}
				} else {
					changed.push({ path: "script", old: formatValue(pv), new: formatValue(nv) });
				}
				break;
			}
			default:
				changed.push({ path: key, old: formatValue(pv), new: formatValue(nv) });
		}
	}

	return { id: next.id, type: next.type, added, removed, changed };
}

function wireKey(w: Wire): string {
	return `${w.from}→${w.to}${w.style ? `:${w.style}` : ""}`;
}

function diffWires(prevWires: Wire[], nextWires: Wire[]): WireDiff {
	const prevSet = new Set(prevWires.map(wireKey));
	const nextSet = new Set(nextWires.map(wireKey));

	const added = nextWires.filter((w) => !prevSet.has(wireKey(w)));
	const removed = prevWires.filter((w) => !nextSet.has(wireKey(w)));

	return { added, removed };
}

export function diffGh(prev: ParsedGrasshopper, next: ParsedGrasshopper): GhDiff {
	const prevIds = new Set(Object.keys(prev.components));
	const nextIds = new Set(Object.keys(next.components));

	const addedComponents = [...nextIds]
		.filter((id) => !prevIds.has(id))
		.map((id) => ({ id, type: next.components[id].type }));

	const removedComponents = [...prevIds]
		.filter((id) => !nextIds.has(id))
		.map((id) => ({ id, type: prev.components[id].type }));

	const components: ComponentDiff[] = [];
	for (const id of nextIds) {
		if (!prevIds.has(id)) continue;
		const cd = diffComponent(prev.components[id], next.components[id]);
		if (cd.added.length > 0 || cd.removed.length > 0 || cd.changed.length > 0) {
			components.push(cd);
		}
	}

	const wires = diffWires(prev.wires, next.wires);

	return {
		addedComponents,
		removedComponents,
		components,
		wires,
	};
}

export function formatDiffSummary(diff: GhDiff): string {
	const lines: string[] = [];

	if (diff.addedComponents.length > 0) {
		lines.push(`+ ${diff.addedComponents.length} component(s) added`);
		for (const c of diff.addedComponents) {
			lines.push(`  + ${c.id} (${c.type})`);
		}
	}

	if (diff.removedComponents.length > 0) {
		lines.push(`- ${diff.removedComponents.length} component(s) removed`);
		for (const c of diff.removedComponents) {
			lines.push(`  - ${c.id} (${c.type})`);
		}
	}

	if (diff.components.length > 0) {
		lines.push(`~ ${diff.components.length} component(s) changed`);
		for (const cd of diff.components) {
			lines.push(`  ~ ${cd.id} (${cd.type})`);
			for (const p of cd.changed) {
				lines.push(`    ${p.path}: ${p.old} → ${p.new}`);
			}
			for (const a of cd.added) {
				lines.push(`    + ${a}`);
			}
			for (const r of cd.removed) {
				lines.push(`    - ${r}`);
			}
		}
	}

	if (diff.wires.added.length > 0) {
		lines.push(`+ ${diff.wires.added.length} wire(s) added`);
		for (const w of diff.wires.added) {
			lines.push(`  + ${w.from} → ${w.to}`);
		}
	}

	if (diff.wires.removed.length > 0) {
		lines.push(`- ${diff.wires.removed.length} wire(s) removed`);
		for (const w of diff.wires.removed) {
			lines.push(`  - ${w.from} → ${w.to}`);
		}
	}

	return lines.length > 0 ? lines.join("\n") : "(no changes)";
}

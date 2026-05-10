import { Requester } from "../infra/requester.js";
import { withRequester } from "../infra/request-helpers.js";
import type { ListAllComponentsResponse, GetCurrentCanvasResponse, GhComponentInfo } from "../types/messages.js";
import type { Component } from "../types/gh.js";
import { buildGhJson } from "../services/parser.js";
import {
	toShortInstanceGuid,
	toShortTypeGuid,
} from "../services/guid-shortener.js";

const CACHE_TTL_MS = 60_000;

let _cache: { data: ListAllComponentsResponse; fetchedAt: number } | null = null;

function shortenComponentGuids(component: Component): Component {
	const shortInputs: Component["inputs"] = {};
	for (const [key, input] of Object.entries(component.inputs)) {
		shortInputs[key] = {
			...input,
			instanceGuid: toShortInstanceGuid(input.instanceGuid),
		};
	}

	const shortOutputs: Component["outputs"] = {};
	for (const [key, output] of Object.entries(component.outputs)) {
		shortOutputs[key] = {
			...output,
			instanceGuid: toShortInstanceGuid(output.instanceGuid),
		};
	}

	return {
		...component,
		typeGuid: toShortTypeGuid(component.typeGuid),
		instanceGuid: toShortInstanceGuid(component.instanceGuid),
		inputs: shortInputs,
		outputs: shortOutputs,
	};
}

export async function getCachedOrFetchComponents(): Promise<ListAllComponentsResponse> {
	if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
		return _cache.data;
	}
	const data = await withRequester(fetchAllComponents);
	_cache = { data, fetchedAt: Date.now() };
	return data;
}

export async function fetchCurrentCanvas(req: Requester): Promise<GetCurrentCanvasResponse> {
	return req.request<GetCurrentCanvasResponse>({ type: "getCurrentCanvas" });
}

export async function fetchAllComponents(req: Requester): Promise<ListAllComponentsResponse> {
	return req.request<ListAllComponentsResponse>({ type: "listAllComponents" });
}

export function formatCanvasResponse(response: GetCurrentCanvasResponse) {
	const parsed = buildGhJson(response.xml);
	const shortComponents = Object.fromEntries(
		Object.entries(parsed.components).map(([id, component]) => [
			id,
			shortenComponentGuids(component),
		])
	);
	const compCount = Object.keys(parsed.components).length;
	const wireCount = parsed.wires.length;

	const lines: string[] = [
		`Canvas: ${response.docName} (${compCount} components, ${wireCount} wires)`,
		"Each component line below shows:",
		"  [id] = readable label (for delete/move/rename/etc tools only)",
		"  guid=COMPONENT_GUID (use THIS for gh_connect_wire / gh_disconnect_wire fromComponent & toComponent)",
		"",
		"Each port line shows:",
		"  guid=PORT_GUID (use THIS for gh_connect_wire / gh_disconnect_wire fromPort & toPort)",
		"  (nick) = nickname for reference ONLY — never pass nicknames to wire tools",
		"",
		"---",
		"",
	];

	for (const [id, c] of Object.entries(shortComponents)) {
		lines.push(`[${id}] ${c.nickName} (${c.type})`);
		lines.push(`  COMPONENT_GUID=${c.instanceGuid}`);

		if (Object.keys(c.outputs).length > 0) {
			lines.push("  OUTPUTS (fromPort values):");
			for (const [key, p] of Object.entries(c.outputs)) {
				lines.push(`    PORT_GUID=${p.instanceGuid}  (${p.nick})`);
			}
		}

		if (Object.keys(c.inputs).length > 0) {
			lines.push("  INPUTS (toPort values):");
			for (const [key, p] of Object.entries(c.inputs)) {
				lines.push(`    PORT_GUID=${p.instanceGuid}  (${p.nick})`);
			}
		}

		if (c.value) {
			const v = c.value;
			if (v.type === "slider") lines.push(`  slider: min=${v.min} max=${v.max} current=${v.current}`);
			else if (v.type === "panel") lines.push(`  panel: "${v.text}"`);
			else if (v.type === "number") lines.push(`  number: current=${v.current}`);
			else lines.push(`  value: ${v.type}`);
		}
		if (c.state?.locked) lines.push("  locked");
		if (c.state?.hidden) lines.push("  hidden");
		lines.push("");
	}

	if (wireCount > 0) {
		lines.push("=== WIRES ===");
		for (const w of parsed.wires) {
			lines.push(`  ${w.from} -> ${w.to}`);
		}
	}

	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: {
			docName: response.docName,
			componentCount: compCount,
			wireCount: wireCount,
			components: shortComponents,
			wires: parsed.wires,
		},
	};
}

function matchComponent(c: GhComponentInfo, f: string) {
	const lower = f.toLowerCase();
	return (
		c.name.toLowerCase().includes(lower) ||
		c.category.toLowerCase().includes(lower) ||
		c.subcategory.toLowerCase().includes(lower) ||
		c.description.toLowerCase().includes(lower)
	);
}

function pickSummary(c: GhComponentInfo) {
	return {
		name: c.name,
		typeGuid: toShortTypeGuid(c.typeGuid),
		category: c.category,
		subcategory: c.subcategory,
	};
}

export function formatComponentsMultiQuery(response: ListAllComponentsResponse, queries?: string[]) {
	const all = response.components;

	if (!queries || queries.length === 0) {
		const lines = all.map((c) => {
			const shortTypeGuid = toShortTypeGuid(c.typeGuid);
			return `  ${c.name}  [${shortTypeGuid}]  (${c.category}/${c.subcategory}) -- ${c.description}`;
		});
		return {
			content: [{ type: "text" as const, text: `All components (${all.length}):\n${lines.join("\n")}` }],
			details: { results: [], totalAvailable: all.length },
		};
	}

	const sections: string[] = [];
	const results: Array<{ queryKeyword: string; result: Array<{ name: string; typeGuid: string; category: string; subcategory: string }> }> = [];

	for (const q of queries) {
		const matched = all.filter((c) => matchComponent(c, q));
		results.push({ queryKeyword: q, result: matched.map(pickSummary) });

		if (matched.length === 0) {
			sections.push(`"${q}" — no matches`);
		} else {
			const lines = matched.map((c) => {
				const shortTypeGuid = toShortTypeGuid(c.typeGuid);
				return `  ${c.name}  [${shortTypeGuid}]  (${c.category}/${c.subcategory}) -- ${c.description}`;
			});
			sections.push(`"${q}" (${matched.length} matches):\n${lines.join("\n")}`);
		}
	}

	return {
		content: [{ type: "text" as const, text: `Components search (${queries.length} queries, ${all.length} available):\n\n${sections.join("\n\n")}` }],
		details: { results, totalAvailable: all.length },
	};
}

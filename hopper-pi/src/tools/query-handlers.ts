import { Requester } from "../infra/requester.js";
import type { ListAllComponentsResponse, GetCurrentCanvasResponse } from "../types/messages.js";
import { buildGhJson } from "../services/parser.js";

export async function fetchCurrentCanvas(req: Requester): Promise<GetCurrentCanvasResponse> {
	return req.request<GetCurrentCanvasResponse>({ type: "getCurrentCanvas" });
}

export async function fetchAllComponents(req: Requester): Promise<ListAllComponentsResponse> {
	return req.request<ListAllComponentsResponse>({ type: "listAllComponents" });
}

export function formatCanvasResponse(response: GetCurrentCanvasResponse) {
	const parsed = buildGhJson(response.xml);
	const compCount = Object.keys(parsed.components).length;
	const wireCount = parsed.wires.length;

	const lines: string[] = [
		`Canvas: ${response.docName} (${compCount} components, ${wireCount} wires)`,
		"",
		"=== COMPONENTS ===",
		"",
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

	for (const [id, c] of Object.entries(parsed.components)) {
		lines.push(`[${id}] ${c.nickName} (${c.type})`);
		lines.push(`  COMPONENT_GUID=${c.instanceGuid}  <-- use this as fromComponent or toComponent in wire tools`);

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
			components: parsed.components,
			wires: parsed.wires,
		},
	};
}

export function formatComponentsList(response: ListAllComponentsResponse, filter?: string) {
	let components = response.components;

	if (filter) {
		const f = filter.toLowerCase();
		components = components.filter(
			(c) =>
				c.name.toLowerCase().includes(f) ||
				c.category.toLowerCase().includes(f) ||
				c.subcategory.toLowerCase().includes(f) ||
				c.description.toLowerCase().includes(f)
		);
	}

	const lines = components.map(
		(c) =>
			`  ${c.name}  [${c.typeGuid}]  (${c.category}/${c.subcategory}) -- ${c.description}`
	);

	return {
		content: [
			{
				type: "text" as const,
				text: `Available components (${components.length} of ${response.components.length}):\n${lines.join("\n")}`,
			},
		],
		details: {
			total: response.components.length,
			filtered: components.length,
			components: components.map((c) => ({
				name: c.name,
				typeGuid: c.typeGuid,
				category: c.category,
				subcategory: c.subcategory,
			})),
		},
	};
}

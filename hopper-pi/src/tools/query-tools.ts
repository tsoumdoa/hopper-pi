import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { withRequester } from "../infra/request-helpers.js";
import type { ListAllComponentsResponse, GetCurrentCanvasResponse } from "../types/messages.js";
import { buildGhJson } from "../services/parser.js";

/**
 * Query tool: fetch current Grasshopper canvas snapshot.
 * Each call fetches live data from the backend — no caching.
 */
export const ghGetCanvasTool = defineTool({
	name: "gh_get_canvas",
	label: "Get Canvas",
	description:
		"Fetch the live Grasshopper canvas from Rhino/Grasshopper backend. " +
		"Returns every component with its instance GUID and every port GUID. " +
		"You MUST call this before any gh_connect_wire or gh_disconnect_wire — copy the 4 GUID values directly from the output.",
	parameters: Type.Object({}),

	async execute(_toolCallId, _params, _signal, onUpdate, _ctx) {
		onUpdate?.({ content: [{ type: "text", text: "Fetching current canvas from backend..." }], details: {} });

		const response = await withRequester<GetCurrentCanvasResponse>(async (req) => {
			return req.request<GetCurrentCanvasResponse>({ type: "getCurrentCanvas" });
		});

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
			content: [{ type: "text", text: lines.join("\n") }],
			details: {
				docName: response.docName,
				componentCount: compCount,
				wireCount: wireCount,
				components: parsed.components,
				wires: parsed.wires,
			},
		};
	},
});

/**
 * Query tool: list all available Grasshopper component types
 * that can be added to the canvas.
 */
export const ghListComponentsTool = defineTool({
	name: "gh_list_components",
	label: "List Components",
	description:
		"List all available Grasshopper component types that can be added to the canvas. Returns name, GUID, category, subcategory, and description. Use this to find the correct component GUID when adding new components.",
	parameters: Type.Object({
		filter: Type.Optional(
			Type.String({
				description:
					"Optional text filter to search component names, categories, or descriptions (case-insensitive partial match)",
			})
		),
	}),

	async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
		onUpdate?.({ content: [{ type: "text", text: "Fetching component registry..." }], details: {} });

		const response = await withRequester<ListAllComponentsResponse>(async (req) => {
			return req.request<ListAllComponentsResponse>({ type: "listAllComponents" });
		});

		let components = response.components;

		if (params.filter) {
			const f = params.filter.toLowerCase();
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
					type: "text",
					text: `Available components (${components.length} of ${response.components.length}):\n${lines.join("\n")}`,
				},
			],
			details: {
				total: response.components.length,
				filtered: components.length,
				components: components.map((c) => ({
					name: c.name,
					guid: c.typeGuid,
					category: c.category,
					subcategory: c.subcategory,
				})),
			},
		};
	},
});

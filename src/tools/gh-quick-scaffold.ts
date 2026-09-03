import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { executeApplyGraph, formatApplyGraphResult } from "../services/gh-apply-graph.js";
import type { ApplyGraphInput, GraphWidgetNode } from "../types/gh-apply-graph.js";

type ScaffoldOutputKind = "brep" | "mesh" | "curves" | "points";

type ScaffoldParameter = {
	name: string;
	min?: number;
	max?: number;
	value?: number;
	digits?: number;
};

type QuickScaffoldInput = {
	intent?: string;
	outputKind?: ScaffoldOutputKind;
	parameters?: ScaffoldParameter[];
	x?: number;
	y?: number;
};

const DEFAULT_PARAMS: Required<ScaffoldParameter>[] = [
	{ name: "Width", min: 1, max: 30, value: 8, digits: 1 },
	{ name: "Depth", min: 1, max: 30, value: 5, digits: 1 },
	{ name: "Height", min: 0.5, max: 15, value: 3, digits: 1 },
	{ name: "Count", min: 3, max: 40, value: 12, digits: 0 },
];

function clampPosition(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 20 ? value : fallback;
}

function sanitizeIdentifier(name: string, fallback: string, used: Set<string>): string {
	let base = name.trim().replace(/[^A-Za-z0-9_]/g, "_");
	base = base.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
	if (!base) base = fallback;

	// Keep generated parameters separate from C# keywords, output parameters,
	// framework types, and local variables used by the scaffold body.
	base = `input_${base}`;
	let candidate = base;
	let i = 2;
	while (used.has(candidate)) {
		candidate = `${base}_${i}`;
		i += 1;
	}
	used.add(candidate);
	return candidate;
}

function normalizeParams(params: ScaffoldParameter[] | undefined): Array<Required<ScaffoldParameter> & { id: string }> {
	const source = params?.length ? params.slice(0, 8) : DEFAULT_PARAMS;
	const used = new Set<string>();
	return source.map((param, index) => {
		const defaults = DEFAULT_PARAMS[Math.min(index, DEFAULT_PARAMS.length - 1)];
		const rawMin = Number.isFinite(param.min) ? param.min as number : defaults.min;
		const rawMax = Number.isFinite(param.max) ? param.max as number : defaults.max;
		const min = Math.min(rawMin, rawMax);
		const max = Math.max(rawMin, rawMax);
		const rawValue = Number.isFinite(param.value) ? param.value as number : defaults.value;
		const value = Math.min(Math.max(rawValue, min), max);
		const digits = Number.isInteger(param.digits) ? Math.min(Math.max(param.digits as number, 0), 12) : defaults.digits;
		return {
			name: param.name?.trim() || defaults.name,
			id: sanitizeIdentifier(param.name || defaults.name, `Param${index + 1}`, used),
			min,
			max,
			value,
			digits,
		};
	});
}

function csharpStringLiteral(value: string): string {
	return JSON.stringify(value);
}

function geometryCode(kind: ScaffoldOutputKind): string {
	switch (kind) {
		case "mesh":
			return "var bbox = new BoundingBox(new Point3d(-w/2, -d/2, 0), new Point3d(w/2, d/2, h));\n    var box = new Box(bbox);\n    var mesh = Mesh.CreateFromBox(box, 1, 1, 1);\n    G = mesh;";
		case "curves":
			return "var curves = new List<Curve>();\n    int n = Math.Max(3, count);\n    for (int i = 0; i < n; i++)\n    {\n      double t = n == 1 ? 0.0 : (double)i / (n - 1);\n      double z = t * h;\n      double r = 0.5 * (w + (d - w) * t);\n      curves.Add(new Circle(new Plane(new Point3d(0, 0, z), Vector3d.ZAxis), Math.Max(0.01, r * 0.5)).ToNurbsCurve());\n    }\n    G = curves;";
		case "points":
			return "var pts = new List<Point3d>();\n    int n = Math.Max(3, count);\n    for (int i = 0; i < n; i++)\n    {\n      double a = 2.0 * Math.PI * i / n;\n      pts.Add(new Point3d(Math.Cos(a) * w * 0.5, Math.Sin(a) * d * 0.5, h * i / Math.Max(1, n - 1)));\n    }\n    G = pts;";
		case "brep":
		default:
			return "var bbox = new BoundingBox(new Point3d(-w/2, -d/2, 0), new Point3d(w/2, d/2, h));\n    G = new Box(bbox).ToBrep();";
	}
}

export function buildQuickScaffoldGraph(input: QuickScaffoldInput): ApplyGraphInput {
	const kind = input.outputKind ?? "brep";
	const x = clampPosition(input.x, 80);
	const y = clampPosition(input.y, 80);
	const params = normalizeParams(input.parameters);
	const intent = input.intent?.trim() || "Grasshopper model";

	const widgets: GraphWidgetNode[] = params.map((param, index) => ({
		ref: `p${index + 1}`,
		kind: "slider" as const,
		x,
		y: y + 44 + index * 34,
		name: param.name,
		min: param.min,
		max: param.max,
		value: param.value,
		digits: param.digits,
	}));

	widgets.push({
		ref: "previewColor",
		kind: "swatch",
		x: x + 520,
		y: y + 95,
		name: "scaffold preview color",
		color: "rgba(120,190,255,210)",
	});
	widgets.push({
		ref: "statusPanel",
		kind: "panel",
		x: x + 520,
		y: y + 155,
		name: "Scaffold status",
		text: "Draft scaffold placed. Main agent/subagents can now replace this placeholder logic.",
		textOutput: "singleString",
		width: 260,
		height: 80,
		bgColor: "rgba(255,245,180,255)",
	});
	widgets.push({
		ref: "title",
		kind: "scribble",
		x,
		y,
		text: `Live scaffold: ${intent}`,
		size: 18,
	});

	const inputSignature = params.map((param) => `double ${param.id}`).join(", ");
	const inputPorts = params.map((param) => ({ name: param.id, typeHint: "double" as const }));
	const first = params[0]?.id ?? "Width";
	const second = params[1]?.id ?? first;
	const third = params[2]?.id ?? first;
	const fourth = params[3]?.id ?? first;
	const statusText = `Visible ${kind} placeholder for: ${intent}. Refine by replacing scaffoldScript code/wires.`;
	const runScript = `private void RunScript(${inputSignature}, ref object G, ref object Status)\n{\n    double w = Math.Max(0.01, ${first});\n    double d = Math.Max(0.01, ${second});\n    double h = Math.Max(0.01, ${third});\n    int count = Math.Max(1, (int)Math.Round(${fourth}));\n\n    ${geometryCode(kind)}\n\n    Status = ${csharpStringLiteral(statusText)};\n}`;

	return {
		widgets,
		components: [{
			ref: "scaffoldPreview",
			type: "Custom Preview",
			x: x + 700,
			y: y + 95,
			name: "Scaffold Preview",
			preview: true,
		}],
		scripts: [{
			ref: "scaffoldScript",
			language: "csharp",
			x: x + 260,
			y: y + 50,
			name: "VISIBLE_OUTPUT_PLACEHOLDER",
			scriptParts: {
				references: ["System", "System.Collections.Generic", "Rhino.Geometry"],
				runScript,
			},
			inputs: inputPorts,
			outputs: [{ name: "G" }, { name: "Status" }],
		}],
		wires: [
			...params.map((param, index) => ({ from: [`p${index + 1}`, 0] as [string, number], to: ["scaffoldScript", param.id] as [string, string] })),
			{ from: ["scaffoldScript", "G"], to: ["scaffoldPreview", "G"] },
			{ from: ["previewColor", 0], to: ["scaffoldPreview", "M"] },
			{ from: ["scaffoldScript", "Status"], to: ["statusPanel", 0] },
		],
		groups: [{
			name: "Live Preview Scaffold — replace/refine",
			refs: ["title", ...params.map((_, index) => `p${index + 1}`), "scaffoldScript", "previewColor", "scaffoldPreview", "statusPanel"],
			color: "rgba(255,220,80,90)",
			border: "Box",
		}],
	};
}

export const ghQuickScaffoldTool = defineTool({
	name: "gh_quick_scaffold",
	label: "Quick Scaffold",
	description:
		"Create an immediate visible Grasshopper scaffold: driving sliders, a placeholder C# script, a swatch-driven Custom Preview, and a status panel. " +
		"Use this early for creative/new-build requests to get something on screen before final logic is worked out; later replace/patch scaffoldScript.",
	promptSnippet: "Place a fast visible Grasshopper placeholder graph before refining final logic",
	promptGuidelines: [
		"For creative Grasshopper new-build requests, call gh_quick_scaffold early when final logic may take time.",
		"Only the main agent should mutate the canvas; subagents should plan/review and the main agent patches scaffoldScript or replaces the scaffold afterward.",
	],
	parameters: Type.Object({
		intent: Type.Optional(Type.String({ description: "Short description shown in the scaffold title/status." })),
		outputKind: Type.Optional(Type.Union([
			Type.Literal("brep"),
			Type.Literal("mesh"),
			Type.Literal("curves"),
			Type.Literal("points"),
		], { description: "Placeholder preview geometry kind. Default: brep." })),
		parameters: Type.Optional(Type.Array(Type.Object({
			name: Type.String({ description: "Slider/input name. Sanitized into a script variable." }),
			min: Type.Optional(Type.Number()),
			max: Type.Optional(Type.Number()),
			value: Type.Optional(Type.Number()),
			digits: Type.Optional(Type.Integer({ minimum: 0, maximum: 12 })),
		}), { maxItems: 8, description: "Driving parameters/sliders. Defaults to Width, Depth, Height, Count. Max 8." })),
		x: Type.Optional(Type.Number({ minimum: 20, description: "Canvas X for scaffold origin. Default 80." })),
		y: Type.Optional(Type.Number({ minimum: 20, description: "Canvas Y for scaffold origin. Default 80." })),
	}),
	async execute(_toolCallId, params, _signal, onUpdate) {
		onUpdate?.({
			content: [{ type: "text", text: "Placing quick visible Grasshopper scaffold..." }],
			details: {},
		});
		const graph = buildQuickScaffoldGraph(params as QuickScaffoldInput);
		const result = await executeApplyGraph(graph);
		const nextStep = result.ok && !result.timedOut
			? "Next: refine by editing scaffoldScript or replacing this grouped scaffold with the final graph."
			: "The scaffold was not confirmed as placed. Resolve the reported error or inspect the canvas before retrying.";
		return {
			content: [{
				type: "text",
				text: `${formatApplyGraphResult(result)}\n${nextStep}`,
			}],
			details: { ...result, scaffoldRef: result.refs.scaffoldScript },
		};
	},
});

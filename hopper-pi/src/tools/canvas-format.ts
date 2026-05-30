import type { Component, InputPort, OutputPort, Wire } from "../types/gh.js";

export function formatCanvasHeaderLine(
	docName: string,
	compCount: number,
	wireCount: number,
): string {
	return `Canvas: ${docName} (${compCount}c, ${wireCount}w)`;
}

function formatPortSide(
	label: "in" | "out",
	ports: Record<string, InputPort | OutputPort>,
): string | null {
	const entries = Object.values(ports);
	if (entries.length === 0) return null;
	const parts = entries.map((p) => `${p.nick} p=${p.instanceGuid}`);
	return `  ${label}: ${parts.join(", ")}`;
}

/** Compact component block for wiring (all ports, short g=/p= labels). */
export function formatComponentDetailLines(id: string, c: Component): string[] {
	const lines: string[] = [`${id} ${c.nickName} ${c.type} g=${c.instanceGuid}`];

	const out = formatPortSide("out", c.outputs);
	const inn = formatPortSide("in", c.inputs);
	if (out) lines.push(out);
	if (inn) lines.push(inn);

	if (c.value) {
		const v = c.value;
		if (v.type === "slider") lines.push(`  val: slider ${v.min}..${v.max} cur=${v.current}`);
		else if (v.type === "panel") lines.push(`  val: panel "${v.text}"`);
		else if (v.type === "number") lines.push(`  val: number ${v.current}`);
		else lines.push(`  val: ${v.type}`);
	}

	const flags: string[] = [];
	if (c.state?.locked) flags.push("locked");
	if (c.state?.hidden) flags.push("hidden");
	if (flags.length > 0) lines.push(`  ${flags.join(" ")}`);

	if (c.visuals?.pivot) {
		const { x, y } = c.visuals.pivot;
		lines.push(`  @${x},${y}`);
	}

	return lines;
}

export function appendWireBlock(lines: string[], wires: Wire[], heading = "WIRES"): void {
	if (wires.length === 0) return;
	lines.push(heading);
	for (const w of wires) {
		lines.push(`  ${w.from} -> ${w.to}`);
	}
	lines.push("");
}

export function appendComponentBlocks(
	lines: string[],
	components: Record<string, Component>,
	ids?: Iterable<string>,
): void {
	const entries = ids
		? [...ids].map((id) => [id, components[id]] as const).filter(([, c]) => c != null)
		: Object.entries(components);
	for (const [compId, c] of entries) {
		lines.push(...formatComponentDetailLines(compId, c));
	}
	if (entries.length > 0) lines.push("");
}

export function canvasDetailsSummary(
	docName: string,
	compCount: number,
	wireCount: number,
	subGraphCount: number,
	subGraphIds?: string[],
): Record<string, unknown> {
	return {
		docName,
		componentCount: compCount,
		wireCount,
		subGraphCount,
		...(subGraphIds && subGraphIds.length > 0 ? { subGraphIds } : {}),
	};
}

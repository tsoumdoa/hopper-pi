import type { GhEditScriptItem } from "../types/gh-edit-script.js";
import type { LinePatch } from "../types/csharp-script.js";
import { lineCount } from "../lib/line-count.js";

function formatIoSummary(
	item: { inputs?: { name: string }[]; outputs?: { name: string }[] },
): string {
	if (item.inputs === undefined && item.outputs === undefined) return "";
	const names = [
		...(item.inputs?.map((i) => `in:${i.name}`) ?? []),
		...(item.outputs?.map((o) => `out:${o.name}`) ?? []),
	];
	return formatIoList(names);
}

function formatIoList(names: string[]): string {
	if (names.length === 0) return " io=∅";
	return ` io=[${names.join(", ")}]`;
}

function formatCodeSource(item: {
	code?: string;
	scriptParts?: { runScript: string; helpers?: string; references?: string[] };
}): string {
	if (item.scriptParts) {
		const refs = item.scriptParts.references?.length ?? 0;
		const parts = [
			`scriptParts(runScript=${lineCount(item.scriptParts.runScript)}L`,
			item.scriptParts.helpers ? `helpers=${lineCount(item.scriptParts.helpers)}L` : null,
			`refs=${refs})`,
		].filter(Boolean);
		return parts.join(", ");
	}
	if (item.code) {
		return `code(${item.code.length}c, ${lineCount(item.code)}L)`;
	}
	return "no-code";
}

export function formatPatchOp(patch: LinePatch): string {
	switch (patch.op) {
		case "insert":
			return `insert after L${patch.afterLine} (+${patch.lines.length}L)`;
		case "replace":
			return `replace L${patch.startLine}-${patch.endLine} → ${patch.lines.length}L`;
		case "delete":
			return `delete L${patch.startLine}-${patch.endLine}`;
	}
}

export function summarizeGhEditScriptItem(item: GhEditScriptItem): string {
	switch (item.action) {
		case "create": {
			const io = formatIoSummary(item);
			const nick = item.nickName ? ` nick="${item.nickName}"` : "";
			return `create ${item.language} @(${item.x},${item.y}) ${formatCodeSource(item)}${nick}${io}`;
		}
		case "setCode": {
			const io = formatIoSummary(item);
			return `setCode target=${item.targetId} ${formatCodeSource(item)}${io}`;
		}
		case "patchCode": {
			const scope = item.scope ?? "(default scope)";
			const patchSummary = item.patches.map(formatPatchOp).join("; ");
			const io = formatIoSummary(item);
			return `patchCode target=${item.targetId} scope=${scope} [${patchSummary}]${io}`;
		}
		case "getCode":
			return `getCode target=${item.targetId}`;
		case "getCodeParts":
			return `getCodeParts target=${item.targetId}`;
	}
}

/** Redact large code bodies; keep structure for monitoring. */
export function sanitizeGhEditScriptItem(item: GhEditScriptItem): Record<string, unknown> {
	switch (item.action) {
		case "create":
			return {
				action: item.action,
				x: item.x,
				y: item.y,
				language: item.language,
				nickName: item.nickName,
				inputs: item.inputs,
				outputs: item.outputs,
				code: item.code ? { chars: item.code.length, lines: lineCount(item.code) } : undefined,
				scriptParts: item.scriptParts
					? {
						references: item.scriptParts.references,
						runScript: { lines: lineCount(item.scriptParts.runScript) },
						helpers: item.scriptParts.helpers
							? { lines: lineCount(item.scriptParts.helpers) }
							: undefined,
					}
					: undefined,
			};
		case "setCode":
			return {
				action: item.action,
				targetId: item.targetId,
				inputs: item.inputs,
				outputs: item.outputs,
				code: item.code ? { chars: item.code.length, lines: lineCount(item.code) } : undefined,
				scriptParts: item.scriptParts
					? {
						references: item.scriptParts.references,
						runScript: { lines: lineCount(item.scriptParts.runScript) },
						helpers: item.scriptParts.helpers
							? { lines: lineCount(item.scriptParts.helpers) }
							: undefined,
					}
					: undefined,
			};
		case "patchCode":
			return {
				action: item.action,
				targetId: item.targetId,
				scope: item.scope,
				inputs: item.inputs,
				outputs: item.outputs,
				patches: item.patches.map((p) => {
					if (p.op === "insert") {
						return { op: p.op, afterLine: p.afterLine, lineCount: p.lines.length };
					}
					if (p.op === "replace") {
						return {
							op: p.op,
							startLine: p.startLine,
							endLine: p.endLine,
							lineCount: p.lines.length,
						};
					}
					return { op: p.op, startLine: p.startLine, endLine: p.endLine };
				}),
			};
		case "getCode":
		case "getCodeParts":
			return { action: item.action, targetId: item.targetId };
	}
}



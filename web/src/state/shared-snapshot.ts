import type { HostSnapshot } from "../../../src/host/protocol.js";
import type { TargetBinding } from "../../../src/protocol/shared-execution.js";

/** One SQLite row from the shared host journal. */
export type Row = Record<string, string | number | null>;

export type SharedTarget = {
	label: string;
	lifecycleInstanceId: string;
	processId: number;
	admission: string;
	documents: TargetBinding[];
	documentLabels?: Record<string, string>;
};

export type SharedSnapshot = {
	historyStorage?: { journalPath: string; sessionsPath: string };
	history?: { conversationId: string | null; before: number | null; hasOlder: boolean; oldestSequence: number | null; pageTaskIds: string[] };
	hostEpoch: string;
	conversationSession?: { id: string; afterConversationSequence: number };
	conversations: Row[];
	sessions: Row[];
	tasks: Row[];
	turns: Row[];
	events: Row[];
	records?: Row[];
	recoveries: Row[];
	questions: Row[];
	inputs?: Row[];
	targets: SharedTarget[];
	runtime: HostSnapshot;
	eventCursor: number;
};

export function decode<T>(value: unknown, fallback: T): T {
	try {
		return JSON.parse(String(value)) as T;
	} catch {
		return fallback;
	}
}

export function sameBinding(a: TargetBinding, b: TargetBinding): boolean {
	if (a.lifecycleInstanceId !== b.lifecycleInstanceId || a.kind !== b.kind) return false;
	return a.kind === "rhino" && b.kind === "rhino"
		? a.rhinoDocumentId === b.rhinoDocumentId
		: a.kind === "grasshopper" && b.kind === "grasshopper"
			&& a.grasshopperDocumentId === b.grasshopperDocumentId
			&& a.associatedRhinoDocumentId === b.associatedRhinoDocumentId;
}

export function targetName(binding: TargetBinding, labels?: Record<string, string>): string {
	if (binding.kind === "rhino") return labels?.[binding.rhinoDocumentId] ?? "Untitled Rhino document";
	const grasshopper = labels?.[binding.grasshopperDocumentId] ?? "Untitled Grasshopper document";
	const rhino = binding.associatedRhinoDocumentId ? ` / ${labels?.[binding.associatedRhinoDocumentId] ?? "Rhino document"}` : "";
	return `${grasshopper}${rhino}`;
}

export function readyTargets(snapshot: SharedSnapshot | undefined): SharedTarget[] {
	return snapshot?.targets.filter((target) => target.admission === "ready") ?? [];
}

/**
 * Builds a labeler that turns a binding into a readable, unambiguous name: untitled or
 * duplicate document names get a number, and the Rhino instance is appended when more than
 * one instance is connected.
 */
export function bindingLabeler(snapshot: SharedSnapshot | undefined): (binding: TargetBinding) => string {
	const available = readyTargets(snapshot);
	return (binding) => {
		const target = snapshot?.targets.find((target) => target.lifecycleInstanceId === binding.lifecycleInstanceId);
		const name = targetName(binding, target?.documentLabels);
		const index = target?.documents.findIndex((document) => sameBinding(document, binding)) ?? -1;
		const duplicates = target?.documents.filter((document) => targetName(document, target.documentLabels) === name).length ?? 0;
		const label = (name.startsWith("Untitled") || duplicates > 1) && index >= 0 ? `${name} ${index + 1}` : name;
		if (available.length > 1 && target) return `${label} · Hopper Code ${available.indexOf(target) + 1 || "offline"}`;
		return label;
	};
}

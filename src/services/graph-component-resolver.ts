import type { GhComponentInfo } from "../types/messages.js";
import type { StructuralError } from "../types/gh-apply-graph.js";
import { toShortTypeGuid } from "./guid-shortener.js";

const GUID_RE = /^[{]?[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}[}]?$/i;

function normalizedGuid(value: string): string {
	return value.trim().toLowerCase().replace(/[{}-]/g, "");
}

function candidateLabel(component: GhComponentInfo): string {
	return `${component.pluginName}/${component.name} [${toShortTypeGuid(component.typeGuid)}]`;
}

function exactCaseInsensitive(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}

export type ComponentResolution =
	| { ok: true; typeGuid: string }
	| { ok: false; error: StructuralError };

export function resolveGraphComponentType(
	components: GhComponentInfo[],
	value: string,
	path: string,
): ComponentResolution {
	const query = value.trim();
	if (!query) {
		return {
			ok: false,
			error: { path, code: "TYPE_REQUIRED", message: "Component type is required." },
		};
	}

	for (const component of components) {
		const short = toShortTypeGuid(component.typeGuid);
		if (
			short === query ||
			(GUID_RE.test(query) && normalizedGuid(component.typeGuid) === normalizedGuid(query))
		) {
			return { ok: true, typeGuid: component.typeGuid };
		}
	}

	const slash = query.indexOf("/");
	let matches: GhComponentInfo[];
	if (slash > 0) {
		const plugin = query.slice(0, slash).trim();
		const name = query.slice(slash + 1).trim();
		matches = components.filter(
			(component) =>
				exactCaseInsensitive(component.pluginName, plugin) &&
				exactCaseInsensitive(component.name, name),
		);
	} else {
		matches = components.filter(
			(component) => exactCaseInsensitive(component.name, query),
		);
	}

	if (matches.length === 1) {
		return { ok: true, typeGuid: matches[0].typeGuid };
	}

	if (matches.length > 1) {
		return {
			ok: false,
			error: {
				path,
				code: "TYPE_AMBIGUOUS",
				message: `Component type "${query}" is ambiguous; use plugin/name or a GUID.`,
				candidates: matches.map(candidateLabel),
			},
		};
	}

	return {
		ok: false,
		error: {
			path,
			code: "TYPE_NOT_FOUND",
			message: `Component type "${query}" was not found. Matching is exact; use gh_list_components to search.`,
		},
	};
}

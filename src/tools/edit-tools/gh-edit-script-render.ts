import type { AgentToolResult, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { summarizeGhEditScriptItem } from "../../services/gh-edit-script-log.js";
import type { GhEditScriptItem } from "../../types/gh-edit-script.js";

export type GhEditScriptDetails = {
	summaries: string[];
	results: string[];
	items: Record<string, unknown>[];
	queryCount: number;
	mutationCount: number;
	error?: string;
	validationErrors?: string[];
};

function renderSummaryLines(summaries: string[], theme: Theme): string {
	return summaries
		.map((summary, index) => {
			const prefix = summaries.length > 1 ? theme.fg("muted", `${index + 1}. `) : "";
			return `${prefix}${theme.fg("accent", summary)}`;
		})
		.join("\n");
}

export function renderGhEditScriptCall(
	args: { items: GhEditScriptItem[] },
	theme: Theme,
): Component {
	const items = args.items ?? [];
	if (items.length === 0) {
		return new Text(theme.fg("toolTitle", theme.bold("gh_edit_script ")) + theme.fg("dim", "(empty)"), 0, 0);
	}

	if (items.length === 1) {
		const text =
			theme.fg("toolTitle", theme.bold("gh_edit_script "))
			+ theme.fg("accent", summarizeGhEditScriptItem(items[0]));
		return new Text(text, 0, 0);
	}

	const text = [
		theme.fg("toolTitle", theme.bold(`gh_edit_script (${items.length} items)`)),
		renderSummaryLines(items.map(summarizeGhEditScriptItem), theme),
	].join("\n");
	return new Text(text, 0, 0);
}

export function renderGhEditScriptResult(
	result: AgentToolResult<GhEditScriptDetails>,
	options: ToolRenderResultOptions,
	theme: Theme,
): Component {
	const details = result.details;

	if (options.isPartial) {
		const partial = result.content[0];
		const text = partial?.type === "text" ? partial.text : "Working...";
		return new Text(theme.fg("warning", text), 0, 0);
	}

	if (details?.validationErrors?.length) {
		return new Text(theme.fg("error", details.validationErrors.join("\n")), 0, 0);
	}

	if (details?.error) {
		return new Text(theme.fg("error", details.error), 0, 0);
	}

	const outcomes = details?.results ?? details?.summaries ?? [];
	let text = outcomes
		.map((line) => `${theme.fg("success", "✓ ")}${theme.fg("text", line)}`)
		.join("\n");

	if (!text) {
		const content = result.content[0];
		text = content?.type === "text" ? content.text : theme.fg("dim", "done");
	}

	if (options.expanded) {
		const content = result.content[0];
		if (content?.type === "text" && content.text.trim()) {
			const preview = content.text.split("\n").slice(0, 25);
			const omitted = content.text.split("\n").length - preview.length;
			text += `\n${theme.fg("muted", "— output —")}`;
			for (const line of preview) {
				text += `\n${theme.fg("dim", line)}`;
			}
			if (omitted > 0) {
				text += `\n${theme.fg("muted", `… ${omitted} more lines`)}`;
			}
		}
	}

	return new Text(text, 0, 0);
}

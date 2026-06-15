import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { throwNoUi } from "./ui-helpers.js";

export function registerAskUserTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description: "Ask the user a free-text question and wait for their answer.",
		promptSnippet: "Ask the user a clarifying question and wait for their answer",
		promptGuidelines: [
			"Use ask_user when requirements are ambiguous and you need clarification before proceeding.",
			"Prefer pick_option over ask_user when you can list 2–6 informed options after reading the canvas.",
		],
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask, with brief context" }),
			placeholder: Type.Optional(Type.String({ description: "Placeholder hint in the input field" })),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				throwNoUi("ask_user");
			}

			const answer = await ctx.ui.input("Question:", params.placeholder ?? params.question);
			const text = answer?.trim() ? answer.trim() : "(no answer)";

			return {
				content: [{ type: "text", text }],
				details: { question: params.question, answer: answer?.trim() ?? null },
			};
		},

		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("ask_user ")) + theme.fg("muted", String(args.question ?? "")),
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as { answer?: string | null } | undefined;
			if (!details?.answer) {
				return new Text(theme.fg("warning", "No answer"), 0, 0);
			}
			return new Text(theme.fg("success", "✓ ") + theme.fg("accent", details.answer), 0, 0);
		},
	});
}

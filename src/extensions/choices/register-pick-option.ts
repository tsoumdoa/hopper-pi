import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { PickOption, PickOptionResult } from "../../types/choices.js";
import {
	OTHER_OPTION_LABEL,
	appendOtherOptionLabels,
	formatPickOptionLabels,
	isOtherChoice,
	resolvePickOption,
} from "../../types/choices.js";
import { throwNoUi } from "./ui-helpers.js";

const OptionSchema = Type.Object({
	label: Type.String({ description: "Display label shown in the picker" }),
	value: Type.String({
		description: "Value returned to the agent (e.g. typeGuid, targetId, scope token)",
	}),
	description: Type.Optional(Type.String({ description: "Short context shown after the label" })),
});

const PROMPT_GUIDELINES = [
	"Use pick_option when multiple valid approaches exist and the user's prompt does not specify which.",
	"Use pick_option after gh_list_components only when 2+ matches remain genuinely plausible — pass typeGuid as each option's value.",
	"Prefer pick_option over ask_user when you can list 2–6 informed options.",
	"Do not include an Other option in pick_option — it is added automatically.",
];

function cancelledResult(question: string): {
	content: [{ type: "text"; text: string }];
	details: PickOptionResult;
} {
	return {
		content: [{ type: "text", text: "User cancelled" }],
		details: {
			question,
			choice: null,
			value: null,
			label: null,
		},
	};
}

export function registerPickOptionTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "pick_option",
		label: "Pick Option",
		description: "Ask the user to choose among 2–6 informed options; an Other choice is appended automatically.",
		promptSnippet: "Present options to the user and wait for their selection",
		promptGuidelines: PROMPT_GUIDELINES,
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask, with brief context" }),
			options: Type.Array(OptionSchema, {
				minItems: 2,
				maxItems: 6,
				description:
					"Options to present (2–6; Other is appended automatically). value is returned to the agent.",
			}),
		}),

		async execute(_id, params, signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				throwNoUi("pick_option");
			}

			const options = params.options as PickOption[];
			if (options.some((option) => isOtherChoice(option.label))) {
				throw new Error(`pick_option reserves the "${OTHER_OPTION_LABEL}" label for custom answers. Rename that option or omit it.`);
			}

			const labels = appendOtherOptionLabels(formatPickOptionLabels(options));
			const choice = await ctx.ui.select(params.question, labels, { signal });

			if (!choice) {
				return cancelledResult(params.question);
			}

			if (isOtherChoice(choice)) {
				const custom = await ctx.ui.input("Please specify:", params.question, { signal });
				const text = custom?.trim();
				if (!text) {
					return cancelledResult(params.question);
				}

				return {
					content: [{ type: "text", text: `Other: ${text}` }],
					details: {
						question: params.question,
						choice,
						value: text,
						label: OTHER_OPTION_LABEL,
						customAnswer: text,
					} satisfies PickOptionResult,
				};
			}

			const selected = resolvePickOption(options, choice);
			const value = selected?.value ?? choice;

			return {
				content: [{ type: "text", text: `Selected: ${selected?.label ?? choice} (value=${value})` }],
				details: {
					question: params.question,
					choice,
					value,
					label: selected?.label ?? choice,
				} satisfies PickOptionResult,
			};
		},

		renderCall(args, theme) {
			const opts = Array.isArray(args.options) ? args.options : [];
			let text = theme.fg("toolTitle", theme.bold("pick_option ")) + theme.fg("muted", String(args.question ?? ""));
			if (opts.length) {
				const labels = opts.map((o: PickOption) => o.label);
				text += `\n${theme.fg("dim", `  ${labels.join(" | ")} | ${OTHER_OPTION_LABEL}`)}`;
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as PickOptionResult | undefined;
			if (!details?.value) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}
			if (details.customAnswer) {
				return new Text(
					theme.fg("success", "✓ ") + theme.fg("accent", `${OTHER_OPTION_LABEL}: ${details.customAnswer}`),
					0,
					0,
				);
			}
			return new Text(theme.fg("success", "✓ ") + theme.fg("accent", details.label ?? details.value), 0, 0);
		},
	});
}

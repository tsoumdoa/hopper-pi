export interface PickOption {
	label: string;
	value: string;
	description?: string;
}

export const OTHER_OPTION_LABEL = "Other";
export const OTHER_OPTION_VALUE = "__other__";

export interface PickOptionResult {
	question: string;
	choice: string | null;
	value: string | null;
	label: string | null;
	customAnswer?: string | null;
}

export function formatPickOptionLabels(options: PickOption[]): string[] {
	return options.map((o) => (o.description ? `${o.label} — ${o.description}` : o.label));
}

export function resolvePickOption(options: PickOption[], choice: string): PickOption | undefined {
	const labels = formatPickOptionLabels(options);
	const idx = labels.indexOf(choice);
	return idx >= 0 ? options[idx] : options.find((o) => o.label === choice || o.value === choice);
}

function hasOtherLikeLabel(labels: string[]): boolean {
	return labels.some((l) => l.toLowerCase().startsWith("other"));
}

export function appendOtherOptionLabels(labels: string[]): string[] {
	if (hasOtherLikeLabel(labels)) return labels;
	return [...labels, OTHER_OPTION_LABEL];
}

export function isOtherChoice(choice: string): boolean {
	return choice === OTHER_OPTION_LABEL;
}

export interface PickOption {
	label: string;
	value: string;
	description?: string;
}

export const OTHER_OPTION_LABEL = "Other";

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

export function appendOtherOptionLabels(labels: string[]): string[] {
	if (labels.some(isOtherChoice)) return labels;
	return [...labels, OTHER_OPTION_LABEL];
}

export function isOtherChoice(choice: string): boolean {
	return choice.trim().toLowerCase() === OTHER_OPTION_LABEL.toLowerCase();
}

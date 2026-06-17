export type ModelLike = {
	input?: readonly string[];
	provider?: string;
	id?: string;
};

export const RH_CAPTURE_VIEW_TOOL = "rh_capture_view";

export function modelSupportsImages(model: ModelLike | null | undefined): boolean {
	return Array.isArray(model?.input) && model.input.includes("image");
}

export function describeModel(model: ModelLike | null | undefined): string {
	if (!model) return "the selected model";
	return model.provider && model.id ? `${model.provider}/${model.id}` : model.id ?? "the selected model";
}

export function parseProviderModel(value: string): { provider: string; model: string } | null {
	const trimmed = value.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) return null;
	return {
		provider: trimmed.slice(0, slash),
		model: trimmed.slice(slash + 1),
	};
}

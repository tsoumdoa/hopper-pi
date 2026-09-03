import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function titleCase(value: string) {
	return String(value ?? "")
		.replaceAll("_", " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const PROVIDER_NAMES: Record<string, string> = {
	anthropic: "Anthropic",
	openai: "OpenAI",
	"openai-codex": "OpenAI Codex",
	google: "Google",
};

export function providerLabel(id: string | null | undefined, providers: Array<{ id: string; name?: string }> = []) {
	if (!id) return "Provider";
	return providers.find((provider) => provider.id === id)?.name ?? PROVIDER_NAMES[id] ?? titleCase(id);
}

export function thinkingLabel(level: string) {
	if (level === "xhigh") return "Extra high";
	if (level === "max") return "Maximum";
	return titleCase(level);
}

export function formatValue(value: unknown) {
	if (value === undefined || value === null || value === "") return "No details";
	if (typeof value === "string") return value;
	if (Array.isArray((value as { content?: unknown[] })?.content)) {
		const text = (value as { content: Array<{ text?: string }> }).content.map((part) => part?.text ?? "").filter(Boolean).join("\n");
		if (text) return text;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

/** One-line preview of a tool payload for collapsed tool rows. */
export function summarizeValue(value: unknown, max = 96) {
	if (value === undefined || value === null || value === "") return "";
	let text: string;
	if (typeof value === "string") text = value;
	else {
		try {
			text = JSON.stringify(value);
		} catch {
			text = String(value);
		}
	}
	text = text.replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function safeExternalUrl(value: unknown) {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value);
		return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
	} catch {
		return undefined;
	}
}

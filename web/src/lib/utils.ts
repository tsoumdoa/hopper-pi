import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function titleCase(value: string) {
	return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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

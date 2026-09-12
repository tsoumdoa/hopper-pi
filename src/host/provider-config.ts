import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const CUSTOM_APIS = [
	"openai-completions",
	"openai-responses",
	"anthropic-messages",
	"google-generative-ai",
] as const;
export type CustomProviderInput = {
	id: string;
	baseUrl: string;
	api: (typeof CUSTOM_APIS)[number];
	modelIds: string[];
	apiKey?: string;
	noAuth: boolean;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	images?: boolean;
};

export function parseCustomProvider(value: unknown): CustomProviderInput {
	if (!value || typeof value !== "object") throw new Error("Invalid provider configuration");
	const v = value as Record<string, unknown>;
	if (typeof v.id !== "string" || !/^custom-[a-z0-9][a-z0-9-]{0,63}$/.test(v.id))
		throw new Error("Use a provider name with letters, numbers, and hyphens");
	if (typeof v.baseUrl !== "string" || v.baseUrl.length > 2048) throw new Error("Enter a valid endpoint URL");
	let url: URL;
	try {
		url = new URL(v.baseUrl);
	} catch {
		throw new Error("Enter a valid endpoint URL");
	}
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
		throw new Error("Use an HTTP or HTTPS endpoint without credentials, query parameters, or fragments");
	if (!CUSTOM_APIS.includes(v.api as CustomProviderInput["api"]))
		throw new Error("Choose a supported API format");
	if (
		!Array.isArray(v.modelIds) ||
		!v.modelIds.length ||
		v.modelIds.length > 100 ||
		v.modelIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 256)
	)
		throw new Error("Enter between 1 and 100 model IDs");
	if (typeof v.noAuth !== "boolean") throw new Error("Choose an authentication method");
	if (!v.noAuth && (typeof v.apiKey !== "string" || !v.apiKey.trim() || v.apiKey.length > 4096))
		throw new Error("Enter an API key or choose no authentication");
	for (const field of ["contextWindow", "maxTokens"] as const) {
		if (
			v[field] !== undefined &&
			(!Number.isSafeInteger(v[field]) || Number(v[field]) < 1 || Number(v[field]) > 10_000_000)
		)
			throw new Error("Token limits must be whole numbers between 1 and 10,000,000");
	}
	if (typeof v.contextWindow === "number" && typeof v.maxTokens === "number" && v.maxTokens > v.contextWindow)
		throw new Error("Maximum output cannot exceed the context window");
	for (const field of ["reasoning", "images"] as const) {
		if (v[field] !== undefined && typeof v[field] !== "boolean") throw new Error("Invalid model capability");
	}
	return {
		...(v.contextWindow === undefined ? {} : { contextWindow: v.contextWindow as number }),
		...(v.maxTokens === undefined ? {} : { maxTokens: v.maxTokens as number }),
		...(v.reasoning === undefined ? {} : { reasoning: v.reasoning as boolean }),
		...(v.images === undefined ? {} : { images: v.images as boolean }),
		id: v.id,
		baseUrl: url.href.replace(/\/$/, ""),
		api: v.api as CustomProviderInput["api"],
		modelIds: [...new Set((v.modelIds as string[]).map((id) => id.trim()))],
		noAuth: v.noAuth,
		...(!v.noAuth ? { apiKey: (v.apiKey as string).trim() } : {}),
	};
}

/** Add only: never silently replace an existing definition or unrelated config. */
export async function addCustomProvider(path: string, input: CustomProviderInput): Promise<void> {
	const provider = parseCustomProvider(input);
	await mkdir(dirname(path), { recursive: true });
	const { openLock, Lock } = await import("@lickle/lock");
	const guard = await openLock(`${path}.lock`, Lock.Exclusive, { timeout: 5000 });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		let content = "{}";
		let config: Record<string, any>;
		try {
			content = await readFile(path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				throw new Error("Could not read existing model configuration. Repair it before adding a provider.");
		}
		const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
		content = content.slice(bom.length);
		const errors: ParseError[] = [];
		config = parse(content, errors);
		if (errors.length)
			throw new Error("Could not parse existing model configuration. Repair it before adding a provider.");
		if (
			!config ||
			typeof config !== "object" ||
			Array.isArray(config) ||
			(config.providers !== undefined &&
				(!config.providers || typeof config.providers !== "object" || Array.isArray(config.providers)))
		)
			throw new Error("Invalid existing model configuration");
		if (Object.hasOwn(config.providers ?? {}, provider.id))
			throw new Error("A provider with this name already exists. Choose another name.");
		const definition = {
			baseUrl: provider.baseUrl,
			api: provider.api,
			// Pi requires configured auth even for servers that ignore credentials.
			...(provider.noAuth ? { apiKey: "hopper-local-no-auth" } : {}),
			models: provider.modelIds.map((id) => ({
				id,
				...(provider.contextWindow === undefined ? {} : { contextWindow: provider.contextWindow }),
				...(provider.maxTokens === undefined ? {} : { maxTokens: provider.maxTokens }),
				...(provider.reasoning === undefined ? {} : { reasoning: provider.reasoning }),
				...(provider.images === undefined ? {} : { input: provider.images ? ["text", "image"] : ["text"] }),
			})),
		};
		const updated = applyEdits(
			content,
			modify(content, ["providers", provider.id], definition, {
				formattingOptions: { insertSpaces: true, tabSize: 2 },
			}),
		);
		await writeFile(temporary, bom + updated, { mode: 0o600, flag: "wx" });
		await rename(temporary, path);
	} finally {
		try {
			await rm(temporary, { force: true });
		} finally {
			await guard.drop();
		}
	}
}

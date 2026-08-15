import { createHash } from "node:crypto";
import {
	acceptedContent,
	inputRequired,
	inputResponse,
	type CallToolResult,
	type InputRequiredResult,
	type RequestStateCodec,
	type ServerContext,
} from "@modelcontextprotocol/server";
import { errorResult } from "../core/tool-error.js";
import { getRhinoVisualCaptureEnvOverride } from "../services/rhino-visual-consent.js";

type CaptureRequestState = {
	purpose: "rhino_capture";
	argsHash: string;
};

const ConsentSchema = {
	type: "object" as const,
	properties: { approved: { type: "boolean" as const } },
	required: ["approved"],
};
const CONSENT_KEY = "captureConsent";

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function argumentsHash(args: unknown): string {
	return createHash("sha256").update(canonicalJson(args)).digest("hex");
}

function consentError(code: "consent_required" | "consent_denied", message: string): CallToolResult {
	const result = errorResult(code, message);
	return {
		content: result.content,
		structuredContent: result.details,
		isError: true,
	};
}

export type CaptureConsentResult =
	| { allowed: true }
	| { result: CallToolResult | InputRequiredResult };

export async function requireCaptureConsent(
	args: unknown,
	ctx: ServerContext,
	codec: RequestStateCodec<CaptureRequestState>,
): Promise<CaptureConsentResult> {
	const override = getRhinoVisualCaptureEnvOverride();
	if (override === "allowed") return { allowed: true };
	if (override === "denied") {
		return {
			result: consentError("consent_denied", "Rhino viewport capture is disabled by the server environment."),
		};
	}

	const hash = argumentsHash(args);
	const response = inputResponse(ctx.mcpReq.inputResponses, CONSENT_KEY);
	if (response.kind === "elicit") {
		const state = ctx.mcpReq.requestState<CaptureRequestState>();
		if (!state || state.purpose !== "rhino_capture" || state.argsHash !== hash) {
			return {
				result: consentError(
					"consent_required",
					"Capture approval did not match this request. Approve the current capture request before retrying.",
				),
			};
		}
		if (response.action !== "accept") {
			return { result: consentError("consent_denied", "Rhino viewport capture was not approved.") };
		}
		const content = acceptedContent<{ approved?: unknown }>(ctx.mcpReq.inputResponses, CONSENT_KEY);
		if (content?.approved === true) return { allowed: true };
		return { result: consentError("consent_denied", "Rhino viewport capture was not approved.") };
	}

	const requestState = await codec.mint(
		{ purpose: "rhino_capture", argsHash: hash },
		ctx,
	);
	return {
		result: inputRequired({
			inputRequests: {
				[CONSENT_KEY]: inputRequired.elicit({
					message: "Allow Hopper to capture this Rhino viewport image?",
					requestedSchema: ConsentSchema,
				}),
			},
			requestState,
		}),
	};
}

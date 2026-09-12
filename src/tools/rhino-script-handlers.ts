import { withRequester } from "../infra/request-helpers.js";
import { RpcOperationError } from "../infra/runtime-rpc.js";
import type { RunRhinoScriptResponse } from "../types/messages.js";

export type RhRunScriptItem = {
	mode: "command" | "python" | "csharp";
	source: string;
	echo?: boolean;
};

export async function runRhinoScript(item: RhRunScriptItem): Promise<string> {
	return withRequester(async (req) => {
		const res = await req.request<RunRhinoScriptResponse>({
			type: "runRhinoScript",
			mode: item.mode,
			source: item.source,
			echo: item.echo ?? false,
		}).catch((error: unknown) => {
			if (!(error instanceof RpcOperationError)) throw error;
			const data = error.result.data;
			// Native failures carry stdout separately from the exception message.
			// Preserve both in the tool text recorded by session exports.
			if (!data || typeof data !== "object" || Array.isArray(data) ||
				data.type !== "runRhinoScript.response") throw error;
			return {
				ok: false,
				error: typeof data.error === "string" ? data.error : error.message,
				output: typeof data.output === "string" ? data.output : "",
			};
		});

		if (!res.ok) {
			const parts = [`FAILED (mode=${item.mode})`];
			if (res.error) parts.push(res.error);
			if (res.output) parts.push(res.output);
			return parts.join("\n");
		}

		const lines = [`OK (mode=${item.mode})`];
		if (res.output) lines.push(res.output);
		return lines.join("\n");
	});
}

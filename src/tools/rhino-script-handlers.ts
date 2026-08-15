import { withRequester } from "../infra/request-helpers.js";
import type { RunRhinoScriptResponse } from "../types/messages.js";

export type RhRunScriptItem = {
	mode: "command" | "python" | "csharp";
	source: string;
	echo?: boolean;
};

export async function runRhinoScript(item: RhRunScriptItem, signal?: AbortSignal): Promise<string> {
	return withRequester(async (req) => {
		const res = await req.request<RunRhinoScriptResponse>({
			type: "runRhinoScript",
			mode: item.mode,
			source: item.source,
			echo: item.echo ?? false,
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
	}, { signal });
}

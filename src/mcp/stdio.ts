#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createHopperMcpServer } from "./create-server.js";

export type HopperStdioOptions = {
	modernOnly: boolean;
};

export function parseStdioArgs(args: readonly string[]): HopperStdioOptions {
	const unknown = args.filter((arg) => arg !== "--modern-only");
	if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
	return { modernOnly: args.includes("--modern-only") };
}

function packageVersion(): string {
	const packageJson = JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	) as { version?: unknown };
	if (typeof packageJson.version !== "string") throw new Error("package.json has no version");
	return packageJson.version;
}

export function startHopperStdio(options: HopperStdioOptions) {
	const version = packageVersion();
	return serveStdio(
		() => createHopperMcpServer({ version }),
		{
			legacy: options.modernOnly ? "reject" : "serve",
			onerror(error) {
				console.error(error);
			},
		},
	);
}

const isMain = process.argv[1] !== undefined &&
	import.meta.url === new URL(process.argv[1], "file:").href;

if (isMain) {
	try {
		startHopperStdio(parseStdioArgs(process.argv.slice(2)));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

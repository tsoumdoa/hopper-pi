import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binIndex = process.argv.indexOf("--bin");
const installedBin = binIndex >= 0 ? resolve(process.argv[binIndex + 1] ?? "") : undefined;
const inspectorBin = process.platform === "win32" ? "mcp-inspector.cmd" : "mcp-inspector";
const serverModule = await import(pathToFileURL(resolve(root, "dist/mcp/create-server.js")).href);
const expected = serverModule.HOPPER_MCP_TOOL_DEFINITIONS.map((tool) => tool.name);
const temp = mkdtempSync(join(tmpdir(), "hopper-inspector-"));

function inspect(era) {
	const isModern = era === "modern";
	const server = installedBin
		? { type: "stdio", command: installedBin, args: isModern ? ["--modern-only"] : [], protocolEra: era }
		: {
			type: "stdio",
			command: process.execPath,
			args: [resolve(root, "dist/mcp/stdio.js"), ...(isModern ? ["--modern-only"] : [])],
			protocolEra: era,
		};
	const config = join(temp, `${era}.json`);
	writeFileSync(config, `${JSON.stringify({ mcpServers: { hopper: server } }, null, 2)}\n`);
	const result = spawnSync(
		inspectorBin,
		["--cli", "--config", config, "--server", "hopper", "--method", "tools/list", "--format", "json"],
		{
			cwd: temp,
			encoding: "utf8",
			timeout: 30_000,
			env: { ...process.env, PATH: `${resolve(root, "node_modules/.bin")}${delimiter}${process.env.PATH ?? ""}` },
		},
	);
	assert.equal(result.error, undefined, `${era} Inspector failed to launch: ${result.error?.message}`);
	assert.equal(result.signal, null, `${era} Inspector timed out or was killed (${result.signal})`);
	assert.equal(result.status, 0, `${era} Inspector failed:\n${result.stderr || result.stdout}`);
	const payload = JSON.parse(result.stdout);
	const tools = payload.tools ?? payload.result?.tools;
	assert.ok(Array.isArray(tools), `${era} Inspector returned no tool array: ${result.stdout}`);
	assert.deepEqual(tools.map((tool) => tool.name), expected);
	assert.equal(tools.length, 16);
	for (const piOnly of ["ask_user", "pick_option", "hopper_search_tools"]) {
		assert.ok(!tools.some((tool) => tool.name === piOnly));
	}
	console.log(`Inspector ${era}: ${tools.length} Hopper tools`);
}

try {
	inspect("legacy");
	inspect("modern");
} finally {
	rmSync(temp, { recursive: true, force: true });
}

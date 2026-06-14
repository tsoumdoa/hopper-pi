import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { COMMAND_ACTIONS } from "./commands.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");

test("TS COMMAND_ACTIONS matches C# CommandActionRegistry", () => {
	const csharpSource = readFileSync(
		join(repoRoot, "grasshopper-plugin/CommandActionRegistry.cs"),
		"utf8",
	);
	const registryBlock = csharpSource.split("KnownActions")[1] ?? "";
	const csharpList = [...registryBlock.matchAll(/"([a-zA-Z][a-zA-Z0-9]*)"/g)].map((m) => m[1]);

	assert.deepEqual([...COMMAND_ACTIONS].sort(), [...csharpList].sort());
});

test("TS CommandAction values are handled in C# CommandExecutor registry", () => {
	const registrySource = readFileSync(
		join(repoRoot, "grasshopper-plugin/CommandExecutor.Registry.cs"),
		"utf8",
	);

	for (const action of COMMAND_ACTIONS) {
		assert.ok(
			registrySource.includes(`["${action}"]`),
			`Missing C# registry handler for action "${action}"`,
		);
	}
});

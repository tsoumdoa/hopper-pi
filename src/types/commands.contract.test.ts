import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { COMMAND_ACTIONS } from "./commands.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../..");
const RHINO_COMMAND_ACTIONS = new Set([
	"beginRhinoAgentTransaction",
	"commitRhinoAgentTransaction",
	"cancelRhinoAgentTransaction",
]);
const GRASSHOPPER_COMMAND_ACTIONS = COMMAND_ACTIONS.filter(
	(action) => !RHINO_COMMAND_ACTIONS.has(action),
);

test("TS Grasshopper command actions match the Grasshopper registry", () => {
	const csharpSource = readFileSync(
		join(repoRoot, "dotnet/Hopper.Grasshopper/CommandActionRegistry.cs"),
		"utf8",
	);
	const registryBlock = csharpSource.split("KnownActions")[1] ?? "";
	const csharpList = [...registryBlock.matchAll(/"([a-zA-Z][a-zA-Z0-9]*)"/g)].map((m) => m[1]);

	assert.deepEqual([...GRASSHOPPER_COMMAND_ACTIONS].sort(), [...csharpList].sort());
});

test("TS Grasshopper command actions are handled by the Grasshopper executor", () => {
	const registrySource = readFileSync(
		join(repoRoot, "dotnet/Hopper.Grasshopper/CommandExecutor.Registry.cs"),
		"utf8",
	);

	for (const action of GRASSHOPPER_COMMAND_ACTIONS) {
		assert.ok(
			registrySource.includes(`["${action}"]`),
			`Missing C# registry handler for action "${action}"`,
		);
	}
});

test("TS Rhino transaction actions are handled by the Rhino adapter", () => {
	const adapterSource = readFileSync(
		join(repoRoot, "dotnet/Hopper.Rhino.Host/RhinoOperationAdapter.cs"),
		"utf8",
	);

	for (const action of RHINO_COMMAND_ACTIONS) {
		assert.ok(
			adapterSource.includes(`RpcOperation.${action}`),
			`Missing Rhino adapter handler for action "${action}"`,
		);
	}
});

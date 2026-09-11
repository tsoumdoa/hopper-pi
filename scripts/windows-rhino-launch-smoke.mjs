import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { TaskJournal } from "../dist/host/shared/journal.js";
import { SharedRegistry } from "../dist/host/shared/registry.js";
import { RhinoLaunchService } from "../dist/host/shared/rhino-launch.js";

// Observe the live host read-only; fixture tasks and permissions stay in a separate journal.
const { values } = parseArgs({ options: {
	"allow-new-test-document": { type: "boolean" }, "source-pid": { type: "string" }, output: { type: "string" },
} });
if (process.platform !== "win32" || !values["allow-new-test-document"] || !values.output || !values["source-pid"])
	throw Error("Usage: node scripts/windows-rhino-launch-smoke.mjs --allow-new-test-document --source-pid <connected Rhino PID> --output <empty directory>. Build first and install the updated native plugin. Leaves the new blank document open.");
const sourcePid = Number(values["source-pid"]);
if (!Number.isSafeInteger(sourcePid) || sourcePid < 1) throw Error("Invalid source PID");
const output = resolve(values.output);
mkdirSync(output, { recursive: true });
if (readdirSync(output).length) throw Error("Use a new empty output directory");
const controlRoot = join(homedir(), ".hopper", "shared-control");
const control = JSON.parse(readFileSync(join(controlRoot, "control.json"), "utf8"));
const discovery = JSON.parse(readFileSync(join(controlRoot, "discovery.json"), "utf8"));
const live = new DatabaseSync(join(control.dataDirectory, "journal.sqlite"), { readOnly: true });
const journal = new TaskJournal(join(output, "launch.sqlite"));
const registry = new SharedRegistry(journal);
let refresh;
try {
	const health = await (await fetch(`http://127.0.0.1:${control.endpointPort}/api/shared/health`)).json();
	if (!health.ready || health.hostEpoch !== discovery.hostEpoch) throw Error("The live Hopper host is not ready");
		const sync = () => {
		for (const row of live.prepare("SELECT payload FROM attachments").all()) {
			const attachment = JSON.parse(row.payload);
			if (attachment.hostEpoch !== discovery.hostEpoch || attachment.admission !== "ready") continue;
			registry.register(attachment);
			registry.markReady(attachment.lifecycleInstanceId, { authenticated: true, generation: attachment.attachmentGeneration,
				operationsIdle: true, rhinoScopeIdle: true, grasshopperScopeIdle: true });
		}
	};
	sync();
	const source = registry.list().find(item => item.processId === sourcePid && item.admission === "ready");
	const binding = source?.documents.find(item => item.kind === "rhino");
	if (!binding) throw Error("Run HopperCode in the source Rhino before this fixture");
	journal.registerSession("windows-launch-fixture", "coordinator");
	const receipt = journal.accept({ requestId: "fixture-root", conversationId: "windows-launch-fixture", sessionId: "coordinator",
		kind: "prompt", text: "Explicit Windows launch fixture; no model calls", bindings: [binding], attachments: [] });
	journal.start(receipt.taskId, receipt.turnId);
	const context = { taskId: receipt.taskId, parentTaskId: null, binding, accessibleBindings: [binding], signal: new AbortController().signal };
	const service = new RhinoLaunchService(journal, registry);
	refresh = setInterval(sync, 500);
	console.log(`Launching one blank Rhino from PID ${sourcePid}; existing documents are not edited.`);
	const start = Date.now();
	const launched = await service.launch(context, { requestId: "worker" });
	const repeated = await service.launch(context, { requestId: "worker" });
	if (launched.process.pid === sourcePid || repeated.process.pid !== launched.process.pid || context.binding !== binding)
		throw Error("Launch identity or parent target changed unexpectedly");
	const child = journal.delegate({ requestId: "fixture-child", conversationId: "windows-launch-fixture", sessionId: "worker",
		parentTaskId: receipt.taskId, dependencies: [], kind: "prompt", text: "Validate delegation admission only", bindings: [launched.binding], attachments: [] });
	const report = { ok: true, elapsedMs: Date.now() - start, sourcePid, sourceBinding: binding, launched,
		duplicateRequestReturnedSameProcess: true, parentBindingPreserved: true, delegationAccepted: Boolean(child.taskId),
		limitations: "Uses the real launch adapter and live host registration, with fixture-only delegation admission. Does not execute geometry or model calls. Verify browser suppression and loaded native build separately." };
	writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report));
} catch (error) {
	writeFileSync(join(output, "failure.json"), JSON.stringify({ error: String(error), launches: journal.snapshot().records.filter(row => row.kind === "launch") }, null, 2));
	throw error;
} finally {
	clearInterval(refresh);
	live.close();
	journal.close();
}

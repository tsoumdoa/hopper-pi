import {
	readFileSync,
	writeFileSync,
	mkdirSync,
	readdirSync,
	realpathSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
// This explicit probe tests a candidate binary; production capability evidence is written only after success.
const { values } = parseArgs({
	options: {
		"allow-new-test-documents": { type: "boolean" },
		"package-directory": { type: "string" },
		output: { type: "string" },
		hold: { type: "boolean" },
	},
});
if (
	!values["allow-new-test-documents"] ||
	!values["package-directory"] ||
	!values.output
)
	throw Error(
		"Usage: node scripts/shared-host-native-smoke.mjs --allow-new-test-documents --package-directory <installed package> --output <private output directory> [--hold]. Close Rhino and stop the shared Node host first. The probe never closes or deletes documents.",
	);
if (process.platform !== "darwin")
	throw Error(
		"This acceptance fixture currently implements the Mac single-process/New workflow only",
	);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedOutputDirectory = resolve(values.output);
mkdirSync(requestedOutputDirectory, { recursive: true, mode: 0o700 });
const outputDirectory = realpathSync(requestedOutputDirectory);
if (readdirSync(outputDirectory).length)
	throw Error(
		"Use a new empty output directory to keep passing and failed evidence separate",
	);
const packageDirectory = resolve(values["package-directory"]);
const executable = "/Applications/Rhino 8.app/Contents/MacOS/Rhinoceros";
const build = execFileSync(
	"/usr/libexec/PlistBuddy",
	[
		"-c",
		"Print :CFBundleVersion",
		"/Applications/Rhino 8.app/Contents/Info.plist",
	],
	{ encoding: "utf8" },
).trim();
const nativePlugin = {
	rhinoPath: join(packageDirectory, "Hopper.Rhino.rhp"),
	corePath: join(packageDirectory, "Hopper.Core.dll"),
};
nativePlugin.rhinoSha256 = createHash("sha256")
	.update(readFileSync(nativePlugin.rhinoPath))
	.digest("hex");
nativePlugin.coreSha256 = createHash("sha256")
	.update(readFileSync(nativePlugin.corePath))
	.digest("hex");
const candidateInstallation = {
	id: "rhino-8-mac",
	executable,
	build,
	platform: "darwin",
	bootstrapVerified: true,
	independentProcessVerified: false,
	bootstrapArguments: (ticket) => ["-runscript=_HopperBootstrap " + ticket],
};
const load = (name) =>
	import(pathToFileURL(join(repository, "dist/host/shared", name + ".js")));
const [
	{ SharedHostControl },
	{ TaskJournal },
	{ SharedRegistry },
	{ SharedNativeRuntime },
	{ SharedTaskService },
	{ createNativeActionAdapters },
	{ DocumentGrantService },
	{ GeometryTransferService },
	{ createLaunchCoordinator },
	{ createSharedBrowserServer },
] = await Promise.all(
	[
		"control",
		"journal",
		"registry",
		"native-runtime",
		"task-service",
		"native-actions",
		"grants",
		"transfer",
		"launch-coordinator",
		"browser-server",
	].map(load),
);
const control = new SharedHostControl();
const state = await control.snapshot();
if (state?.desiredState !== "running")
	throw Error("Host intent must be running");
const discovery = {
	hostEpoch: randomUUID(),
	pid: process.pid,
	processStartIdentity: new Date().toISOString(),
	protocolVersion: 2,
	schemaVersion: 2,
	registrationToken: randomBytes(32).toString("hex"),
	endpointPort: state.endpointPort,
	dataDirectory: state.dataDirectory,
	journalIdentity: state.journalIdentity,
	revision: state.revision,
};
let journal, native, registry, tasks, launches, documents, transfer;
let ready = false,
	refreshing = false,
	timer,
	refreshWork,
	finished = false,
	fixtureTask,
	passingReport,
	passingEvidence;
const reportPath = join(outputDirectory, "report.json");
const browser = createSharedBrowserServer({
	browserCredential: state.browserCredential,
	registrationCredential: discovery.registrationToken,
	staticDir: join(repository, "dist/host/static"),
	backend: {
		snapshot: () => ({
			fixture: true,
			targets: registry?.list() ?? [],
			...(journal?.snapshot() ?? {}),
		}),
		command: async () => {
			throw Error("Native acceptance fixture in progress");
		},
		subscribe: () => () => {},
	},
	health: () => ({ ...discovery, registrationToken: undefined, ready }),
	register: async (request) => {
		const result = await native.register(request);
		await launches.registered(request, result);
		return result;
	},
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = async (condition, description, timeout = 180000) => {
	const until = Date.now() + timeout;
	while (Date.now() < until) {
		const result = condition();
		if (result) return result;
		await sleep(100);
	}
	throw Error("Timed out: " + description);
};
function data(response) {
	if (response.result.class !== "completed")
		throw Error(JSON.stringify(response.result));
	const value = response.result.data;
	if (value?.ok === false) throw Error(JSON.stringify(value));
	return value;
}
async function mutation(owner, name, args, cleanup = false) {
	const record = journal.operationIntent({
		taskId: owner.taskId,
		turnId: owner.turnId,
		name,
		operationClass: "mutation",
		arguments: args,
		owner,
		cleanup,
		deadline: Date.now() + 30000,
	});
	try {
		const response = await native
			.getClient(owner.binding.lifecycleInstanceId)
			.call(name, args, {
				executionOwner: owner,
				operationId: record.operationId,
			});
		const result = data(response);
		journal.operationResult(record.id, "completed", response);
		return result;
	} catch (error) {
		journal.operationResult(record.id, "uncertain", { error: String(error) });
		throw error;
	}
}
async function script(taskId, binding, source) {
	return tasks.withProcess(taskId, binding, async (owner) => {
		await native.activateBinding(owner);
		await mutation(owner, "beginRhinoAgentTransaction", {
			name: "Native acceptance fixture",
		});
		let result,
			failed = false;
		try {
			result = await mutation(owner, "runRhinoScript", {
				mode: "python",
				source,
				echo: false,
			});
		} catch (error) {
			failed = true;
			throw error;
		} finally {
			const segment = data(
				await native
					.getClient(binding.lifecycleInstanceId)
					.call("getDocumentTransactionState", { owner: "rhino" }),
			);
			await mutation(
				owner,
				failed ? "cancelRhinoAgentTransaction" : "commitRhinoAgentTransaction",
				{ expectedSegment: segment },
				true,
			);
		}
		return result;
	});
}
try {
	await control.acquireOwnership(browser.server, state.revision);
	journal = new TaskJournal(join(state.dataDirectory, "journal.sqlite"));
	if (journal.identity !== state.journalIdentity)
		throw Error("Pinned journal identity mismatch");
	if (
		journal
			.snapshot()
			.tasks.some(
				(task) => !["completed", "failed", "cancelled"].includes(task.state),
			) ||
		journal
			.snapshot()
			.operations.some((operation) =>
				["accepted", "dispatched"].includes(operation.state),
			)
	)
		throw Error(
			"Finish or reconcile existing shared tasks before running this fixture",
		);
	journal.recover();
	registry = new SharedRegistry(journal);
	native = new SharedNativeRuntime(discovery.hostEpoch, registry, journal);
	tasks = new SharedTaskService(journal, {
		resolveBinding: (b) => registry.resolveBinding(b),
		resolveLifecycle: (id) => registry.resolveLifecycle(id),
		validateBinding: (o) => registry.validateBinding(o),
		createDriver: (context) => ({
			run: async () => {
				const requestId = context.taskId + ":launch";
				await launches.authorize({
					requestId,
					rootTaskId: context.taskId,
					installationId: "rhino-8-mac",
					independentProcess: false,
				});
				await launches
					.tools(context)
					.find((tool) => tool.name === "launchRhino")
					.execute("native-fixture", { requestId });
				const launch = await wait(() => {
					const row = journal
						.snapshot()
						.records.find(
							(row) => row.kind === "launch" && row.id === requestId,
						);
					if (row?.state === "completed") return JSON.parse(row.payload);
					if (row && ["failed", "cancelled", "uncertain"].includes(row.state))
						throw Error("Launch did not complete: " + row.state);
				}, "first launch document");
				const source = launch.binding;
				await script(
					context.taskId,
					source,
					`import System, os, Rhino\nimport scriptcontext as sc\nassert not sc.doc.Path and sc.doc.Objects.Count == 0 and not sc.doc.Modified, 'Recovered or existing document: preserve and stop fixture'\nlocations=[str(a.Location) for a in System.AppDomain.CurrentDomain.GetAssemblies() if not a.IsDynamic]\nassert ${JSON.stringify(nativePlugin.rhinoPath)} in locations, 'Rhino plugin loaded from another package'\nassert ${JSON.stringify(nativePlugin.corePath)} in locations, 'Core plugin loaded from another package'\nprint('HOPPER_LOADED_PACKAGE_VERIFIED')`,
				);
				const grant = documents.authorize({
					requestId: context.taskId + ":new-document",
					taskId: context.taskId,
					lifecycleInstanceId: source.lifecycleInstanceId,
					kind: "rhino",
					action: "new",
					modifiedPolicy: "refuse",
				});
				const destination = (await documents.execute(grant.grantId)).binding;
				const objectScript =
					"import Rhino\nimport scriptcontext as sc\nidentifier=sc.doc.Objects.AddSphere(Rhino.Geometry.Sphere(Rhino.Geometry.Point3d(0,0,0),1000))\nprint('HOPPER_TEST_OBJECT='+str(identifier))";
				const created = await script(context.taskId, source, objectScript);
				const match = JSON.stringify(created).match(
					/HOPPER_TEST_OBJECT=([a-f0-9-]{36})/i,
				);
				if (!match)
					throw Error(
						"No source sphere identity returned: " + JSON.stringify(created),
					);
				const sourceId = match[1];
				await script(
					context.taskId,
					destination,
					"import Rhino\nimport scriptcontext as sc\nsc.doc.ModelUnitSystem=Rhino.UnitSystem.Meters\nprint('destination-units-meters')",
				);
				const artifact = await transfer.export({
					requestId: context.taskId + ":export",
					taskId: context.taskId,
					source,
					objectIds: [sourceId],
				});
				const receipt = await transfer.import({
					requestId: context.taskId + ":import",
					taskId: context.taskId,
					artifactId: artifact.artifactId,
					destination,
					destinationUnits: "Meters",
				});
				if (
					receipt.objectIds.length !== 1 ||
					receipt.objectIds[0].toLowerCase() === sourceId.toLowerCase()
				)
					throw Error("Destination identity was reused");
				if (
					createHash("sha256")
						.update(readFileSync(artifact.path))
						.digest("hex") !== artifact.checksum
				)
					throw Error("Published artifact checksum mismatch");
				if (
					artifact.units !== "Millimeters" ||
					receipt.provenance?.length !== 1 ||
					receipt.provenance[0].sourceObjectId.toLowerCase() !==
						sourceId.toLowerCase() ||
					!receipt.layerId
				)
					throw Error("Missing units, provenance or dedicated layer evidence");
				const inspect = (objectId, radius) =>
					`import Rhino, System, json\nimport scriptcontext as sc\no=sc.doc.Objects.FindId(System.Guid('${objectId}'))\nassert o is not None\nb=o.Geometry.GetBoundingBox(True)\nassert abs(b.Max.X-${radius})<0.00001 and abs(b.Min.X+${radius})<0.00001\nassert not sc.doc.Path\nprint('HOPPER_TEST_VERIFIED='+json.dumps({'id':str(o.Id),'units':str(sc.doc.ModelUnitSystem),'layerId':str(sc.doc.Layers[o.Attributes.LayerIndex].Id),'path':sc.doc.Path,'maxX':b.Max.X}))`;
				const sourceVerification = await script(
					context.taskId,
					source,
					inspect(sourceId, 1000),
				);
				const destinationVerification = await script(
					context.taskId,
					destination,
					inspect(receipt.objectIds[0], 1),
				);
				if (!JSON.stringify(destinationVerification).includes(receipt.layerId))
					throw Error("Destination object not on receipt layer");
				if (
					createHash("sha256")
						.update(readFileSync(nativePlugin.rhinoPath))
						.digest("hex") !== nativePlugin.rhinoSha256 ||
					createHash("sha256")
						.update(readFileSync(nativePlugin.corePath))
						.digest("hex") !== nativePlugin.coreSha256
				)
					throw Error("Plugin binary changed during probe");
				const { getRuntimeRpc } = await import(
					pathToFileURL(join(repository, "dist/infra/runtime-rpc.js"))
				);
				const savedDocuments = [];
				for (const [label, binding] of [
					["source", source],
					["destination", destination],
				]) {
					const saved = await tasks.withProcess(
						context.taskId,
						binding,
						async (owner) => {
							const geometry = await native.geometry({
								...context,
								binding,
								owner,
							});
							try {
								return await geometry.runtimeSession.run(async () => {
									const rpc = getRuntimeRpc();
									rpc.beginAgentTurn();
									const observed = await rpc.request("getRhinoDocument", {
										documentId: binding.rhinoDocumentId,
									});
									const path = join(
										outputDirectory,
										label + "-managed-save.3dm",
									);
									const result = await rpc.request("manageRhinoDocument", {
										action: "saveAs",
										documentId: binding.rhinoDocumentId,
										expectedStateToken: observed.stateToken,
										path,
									});
									if (
										result.ok !== true ||
										result.document?.path !== path ||
										result.document?.isModified !== false
									)
										throw Error(
											"Managed saveAs did not report saved document: " +
												JSON.stringify(result),
										);
									return { label, path, result };
								});
							} finally {
								await geometry.cleanup();
							}
						},
					);
					savedDocuments.push(saved);
				}
				const evidence = {
					installations: [
						{
							id: candidateInstallation.id,
							executable,
							build,
							bootstrapVerified: true,
							independentProcessVerified: false,
							nativePlugin,
							probeRequestId: requestId,
							testedAt: new Date().toISOString(),
						},
					],
				};
				passingEvidence = evidence;
				const report = {
					status: "transferred",
					savedDocuments,
					sourceVerification,
					destinationVerification,
					nativePlugin,
					hostEpoch: discovery.hostEpoch,
					taskId: context.taskId,
					source,
					destination,
					sourceId,
					receipt,
					artifact,
				};
				passingReport = report;
				finished = true;
				return { usage: 0 };
			},
			steer: async () => {},
			cancel: async () => {},
			cleanup: async () => {
				const scopes = [];
				try {
					for (const attachment of registry
						.list()
						.filter((item) => item.admission === "ready"))
						for (const owner of ["rhino", "grasshopper"])
							scopes.push(
								data(
									await native
										.getClient(attachment.lifecycleInstanceId)
										.call(
											"getDocumentTransactionState",
											{ owner },
											{ completionTimeoutMs: 3000 },
										),
								),
							);
					return {
						confirmed: scopes.every((scope) => scope.state === "idle"),
						evidence: { scopes },
					};
				} catch (error) {
					return {
						confirmed: false,
						evidence: { error: String(error), scopes },
					};
				}
			},
		}),
	});
	const adapters = createNativeActionAdapters(native, journal, registry);
	documents = new DocumentGrantService(journal, tasks, adapters.documents);
	transfer = new GeometryTransferService(
		journal,
		tasks,
		join(outputDirectory, "artifacts"),
		adapters.transfer,
	);
	launches = await createLaunchCoordinator({
		journal,
		control,
		registry,
		documentActions: documents,
		installations: [candidateInstallation],
	});
	ready = true;
	await control.publish(discovery);
	timer = setInterval(() => {
		if (refreshing) return;
		refreshing = true;
		refreshWork = native
			.refresh()
			.then(() => launches.refresh())
			.catch((error) => console.error("Fixture refresh:", error.message))
			.finally(() => {
				refreshing = false;
			});
	}, 500);
	const conversation = journal.createConversation(
		"transfer-fixture-conversation-" + Date.now(),
		"Native geometry transfer acceptance fixture",
	);
	fixtureTask = tasks.submit({
		...conversation,
		requestId: "transfer-fixture-root-" + Date.now(),
		kind: "prompt",
		text: "Explicit deterministic native launch, New and geometry transfer fixture. No model API is called.",
		diagnosticFixture: "shared-host-native-smoke",
		bindings: [],
		attachments: [],
	});
	console.log(
		JSON.stringify({
			status: "fixture-host-ready",
			pid: process.pid,
			taskId: fixtureTask.taskId,
		}),
	);
	await wait(
		() => {
			const row = journal
				.snapshot()
				.tasks.find((row) => row.id === fixtureTask.taskId);
			if (row && ["failed", "uncertain", "cancelled"].includes(row.state)) {
				writeFileSync(
					reportPath,
					JSON.stringify(
						{
							status: row.state,
							taskId: fixtureTask.taskId,
							events: journal
								.snapshot()
								.events.filter((event) => event.task_id === fixtureTask.taskId),
						},
						null,
						2,
					),
					{ mode: 0o600 },
				);
				throw Error("Fixture task " + row.state);
			}
			return finished && row?.state === "completed";
		},
		"native transfer fixture",
		240000,
	);
	writeFileSync(
		join(outputDirectory, "launch-capabilities.json"),
		JSON.stringify(passingEvidence, null, 2),
		{ mode: 0o600, flag: "wx" },
	);
	writeFileSync(reportPath, JSON.stringify(passingReport, null, 2), {
		mode: 0o600,
		flag: "wx",
	});
	console.log(
		JSON.stringify({
			status: "transferred",
			taskId: passingReport.taskId,
			artifactId: passingReport.artifact.artifactId,
		}),
	);
	console.log(
		"Native transfer fixture operations completed; test documents remain open for inspection. With --hold, host waits for SIGTERM.",
	);
	if (values.hold)
		await new Promise((resolve) => {
			process.once("SIGTERM", resolve);
			process.once("SIGINT", resolve);
		});
} catch (error) {
	console.error("Native fixture failed:", error.stack);
	writeFileSync(join(outputDirectory, "error.txt"), String(error.stack));
	process.exitCode = 1;
} finally {
	if (timer) clearInterval(timer);
	await tasks?.stop();
	await refreshWork?.catch(() => {});
	await native?.close();
	await browser.close();
	journal?.close();
}

import { Command } from "commander";
import chalk from "chalk";
import * as readline from "node:readline/promises";
import { nanoid } from "nanoid";
import { withRequester } from "../../infra/request-helpers.js";
import { Publisher } from "../../infra/publisher.js";
import { parseGrasshopper } from "../../services/parser.js";
import type {
	ListAllComponentsResponse,
	GetCurrentCanvasResponse,
	GhComponentInfo,
} from "../../types/messages.js";
import type { SubmitJobRequest } from "../../types/commands.js";

const COLS = 10;
const SPACING = 120;
const ADD_SETTLE_MS = 200;
const DELETE_SETTLE_MS = 200;

const SKIP_GUIDS = new Set(["e07753b1-fdec-417a-b57a-83a95204a8dd"]);

function isSkipped(c: GhComponentInfo): boolean {
	return SKIP_GUIDS.has(c.guid) || c.name.includes("[OBSOLETE]") || c.name.includes("(Deconstruct)") || c.name.includes("(LEGACY)");
}

interface BatchResult {
	category: string;
	subcategory: string;
	components: GhComponentInfo[];
	published: GhComponentInfo[];
	failed: Array<{ component: GhComponentInfo; reason: string }>;
	missingFromCanvas: GhComponentInfo[];
	deleteFailed: string[];
	stillOnCanvas: string[];
}

async function publishAddCommands(
	publisher: Publisher,
	components: GhComponentInfo[]
): Promise<{ published: GhComponentInfo[]; failed: Array<{ component: GhComponentInfo; reason: string }> }> {
	const published: GhComponentInfo[] = [];
	const failed: Array<{ component: GhComponentInfo; reason: string }> = [];

	for (let i = 0; i < components.length; i++) {
		const comp = components[i];
		const col = i % COLS;
		const row = Math.floor(i / COLS);
		const x = (col * SPACING) + SPACING;
		const y = (row * SPACING) + SPACING;

		const request: SubmitJobRequest = {
			type: "submitJob",
			jobId: `test-${nanoid(8)}`,
			command: {
				action: "addComponent",
				params: { guid: comp.guid, position: { x, y } },
			},
		};

		try {
			await publisher.publishCommand(request);
			published.push(comp);
			process.stdout.write(`    ${chalk.cyan(comp.name)} (${comp.guid})${chalk.green(" ✓")}\n`);
			if (i < components.length - 1) await new Promise((r) => setTimeout(r, 20));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			failed.push({ component: comp, reason: message });
			process.stdout.write(`    ${chalk.cyan(comp.name)} (${comp.guid})${chalk.red(` ✗ ${message}`)}\n`);
		}
	}

	return { published, failed };
}

async function getCanvasComponents() {
	const response = await withRequester<GetCurrentCanvasResponse>(async (requester) => {
		return requester.request<GetCurrentCanvasResponse>({ type: "getCurrentCanvas" });
	});

	const xmlParser = new (await import("fast-xml-parser")).XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: "",
		parseAttributeValue: false,
		parseTagValue: false,
		trimValues: true,
		isArray: (name) => ["item", "chunk"].includes(name),
	});
	const parsed = xmlParser.parse(response.xml);
	return parseGrasshopper(parsed);
}

async function publishDeleteCommands(
	publisher: Publisher,
	targetIds: string[]
): Promise<string[]> {
	const failed: string[] = [];
	for (let i = 0; i < targetIds.length; i++) {
		const request: SubmitJobRequest = {
			type: "submitJob",
			jobId: `del-${nanoid(8)}`,
			command: {
				action: "deleteComponent",
				params: { targetId: targetIds[i] },
			},
		};
		try {
			await publisher.publishCommand(request);
			if (i < targetIds.length - 1) await new Promise((r) => setTimeout(r, 50));
		} catch {
			failed.push(targetIds[i]);
		}
	}
	return failed;
}

export async function testAddAllComponents(): Promise<void> {
	console.log(chalk.bold("=== Test: Add All Components (Batched) ===\n"));

	const componentsResponse = await withRequester<ListAllComponentsResponse>(async (requester) => {
		return requester.request<ListAllComponentsResponse>({ type: "listAllComponents" });
	});

	const allComponents = componentsResponse.components;
	const [skipped, toProcess] = allComponents.reduce(
		(acc, c) => {
			acc[isSkipped(c) ? 0 : 1].push(c);
			return acc;
		},
		[[] as GhComponentInfo[], [] as GhComponentInfo[]]
	);

	console.log(chalk.green(`Found ${allComponents.length} total, ${toProcess.length} to test, ${skipped.length} skipped\n`));

	if (skipped.length > 0) {
		for (const s of skipped) {
			process.stdout.write(`  ${chalk.gray(`skipped ${s.name} (${s.guid})`)}\n`);
		}
		console.log("");
	}

	const batches = groupByCategory(toProcess);
	console.log(chalk.gray(`Grouped into ${batches.length} subcategory batches\n`));

	const publisher = new Publisher();
	await publisher.connect();

	const allResults: BatchResult[] = [];

	console.log(chalk.gray("\nAvailable batches:"));
	for (let i = 0; i < batches.length; i++) {
		const b = batches[i];
		process.stdout.write(`    ${i + 1}. ${b.category} / ${b.subcategory} (${b.components.length})\n`);
	}

	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const startInput = await rl.question(chalk.cyan(`Start from batch (1-${batches.length}, Enter for all): `));
	rl.close();

	let startIndex = 0;
	if (startInput.trim() !== "") {
		startIndex = parseInt(startInput, 10) - 1;
		if (isNaN(startIndex) || startIndex < 0 || startIndex >= batches.length) {
			console.log(chalk.red("Invalid input, starting from batch 1"));
			startIndex = 0;
		}
	}

	for (let bi = startIndex; bi < batches.length; bi++) {
		const batch = batches[bi];
		const label = `${batch.category} / ${batch.subcategory}`;

		console.log(chalk.bold(`\n--- Batch ${bi + 1}/${batches.length}: ${label} (${batch.components.length} components) ---`));

		const { published, failed } = await publishAddCommands(publisher, batch.components);

		console.log(chalk.gray(`  Waiting ${ADD_SETTLE_MS}ms...`));
		await new Promise((r) => setTimeout(r, ADD_SETTLE_MS));

		const currentDoc = await getCanvasComponents();
		const canvasTypeGuidMap = new Map<string, string>();
		for (const [id, comp] of Object.entries(currentDoc.components)) {
			canvasTypeGuidMap.set(comp.typeGuid, comp.instanceGuid);
		}

		const missingFromCanvas = published.filter((c) => !canvasTypeGuidMap.has(c.guid));
		const deletable = published
			.filter((c) => canvasTypeGuidMap.has(c.guid))
			.filter((c) => !SKIP_GUIDS.has(c.guid));
		let idsToDelete = deletable
			.map((c) => canvasTypeGuidMap.get(c.guid)!);

		if (idsToDelete.length > 0 || missingFromCanvas.length > 0) {
			if (idsToDelete.length > 0) {
				console.log(chalk.gray(`  Deleting ${idsToDelete.length} components from canvas...`));
				var deleteFailed = await publishDeleteCommands(publisher, idsToDelete);

				console.log(chalk.gray(`  Waiting ${DELETE_SETTLE_MS}ms...`));
				await new Promise((r) => setTimeout(r, DELETE_SETTLE_MS));
			} else {
				var deleteFailed = [] as string[];
			}

			const afterDelete = await getCanvasComponents();
			const afterDeleteIds = new Set(Object.keys(afterDelete.components));
			const stillOnCanvas = idsToDelete.filter((id) => afterDeleteIds.has(id));

			if (stillOnCanvas.length > 0) {
				console.log(chalk.yellow(`  ⚠ ${stillOnCanvas.length} components still on canvas after delete!`));
				for (const id of stillOnCanvas) {
					console.log(`    ${chalk.yellow(`  still present: ${id}`)}`);
				}
			} else if (idsToDelete.length > 0) {
				console.log(chalk.green(`  ✓ All components deleted from canvas`));
			}

			if (missingFromCanvas.length > 0) {
				console.log(chalk.yellow(`  ⚠ ${missingFromCanvas.length} components were not found on canvas after add:`));
				for (const c of missingFromCanvas) {
					console.log(`    ${chalk.yellow(`${c.name} (${c.guid})`)}`);
				}
			}

			allResults.push({
				category: batch.category,
				subcategory: batch.subcategory,
				components: batch.components,
				published,
				failed,
				missingFromCanvas,
				deleteFailed,
				stillOnCanvas,
			});
		} else {
			allResults.push({
				category: batch.category,
				subcategory: batch.subcategory,
				components: batch.components,
				published,
				failed,
				missingFromCanvas,
				deleteFailed: [],
				stillOnCanvas: [],
			});
		}

		console.log(chalk.gray(`  Sub-result: ${chalk.green(`${published.length} added`)}, ${chalk.red(`${failed.length} failed`)}, ${chalk.yellow(`${missingFromCanvas.length} missing from canvas`)}`));
	}

	await publisher.close();

	printFinalSummary(allResults, toProcess.length);
}

function groupByCategory(components: GhComponentInfo[]): Array<{
	category: string;
	subcategory: string;
	components: GhComponentInfo[];
}> {
	const map = new Map<string, GhComponentInfo[]>();
	for (const c of components) {
		const key = `${c.category}::${c.subcategory}`;
		let arr = map.get(key);
		if (!arr) {
			arr = [];
			map.set(key, arr);
		}
		arr.push(c);
	}
	return [...map.entries()]
		.map(([key, comps]) => {
			const [cat, sub] = key.split("::");
			return { category: cat, subcategory: sub, components: comps };
		})
		.sort((a, b) => a.category.localeCompare(b.category) || a.subcategory.localeCompare(b.subcategory));
}

function printFinalSummary(results: BatchResult[], totalAttempted: number): void {
	console.log(chalk.bold("\n\n============================"));
	console.log(chalk.bold("=== FINAL SUMMARY ==="));
	console.log(chalk.bold("============================\n"));

	let totalPublished = 0;
	let totalFailed = 0;
	let totalMissing = 0;
	let totalDeleteFailed = 0;
	let totalStillOnCanvas = 0;

	for (const r of results) {
		totalPublished += r.published.length;
		totalFailed += r.failed.length;
		totalMissing += r.missingFromCanvas.length;
		totalDeleteFailed += r.deleteFailed.length;
		totalStillOnCanvas += r.stillOnCanvas.length;
	}

	console.log(`  Total attempted:     ${totalAttempted}`);
	console.log(`  ${chalk.green("  Published:")}          ${totalPublished}`);
	console.log(`  ${chalk.red("  Publish failures:")}   ${totalFailed}`);
	console.log(`  ${chalk.yellow("  Missing from canvas:")} ${totalMissing}`);
	console.log(`  ${chalk.red("  Delete failures:")}    ${totalDeleteFailed}`);
	console.log(`  ${chalk.yellow("  Still on canvas:")}    ${totalStillOnCanvas}`);

	const allFailed = results.flatMap((r) =>
		r.failed.map((f) => ({ ...f, batch: `${r.category}/${r.subcategory}` }))
	);
	if (allFailed.length > 0) {
		console.log(chalk.bold("\nAll publish failures:"));
		for (const f of allFailed) {
			console.log(`  ${chalk.red("✗")} [${f.batch}] ${f.component.name} (${f.component.guid}) — ${f.reason}`);
		}
	}

	const allMissing = results.flatMap((r) =>
		r.missingFromCanvas.map((c) => ({ ...c, batch: `${r.category}/${r.subcategory}` }))
	);
	if (allMissing.length > 0) {
		console.log(chalk.bold("\nAll missing from canvas:"));
		for (const m of allMissing) {
			console.log(`  ${chalk.yellow("⚠")} [${m.batch}] ${m.name} (${m.guid})`);
		}
	}

	if (totalFailed === 0 && totalMissing === 0 && totalStillOnCanvas === 0) {
		console.log(chalk.green("\n✓ All components tested successfully!"));
	}
}

export function createTestAddAllCommand(program: Command): void {
	program
		.command("test add-all-components")
		.description(
			"Test: list all components, add each subcategory batch, verify, delete, then next batch"
		)
		.action(async () => {
			try {
				await testAddAllComponents();
			} catch (err) {
				console.error(chalk.red("Error:"), err);
				process.exit(1);
			}
		});
}

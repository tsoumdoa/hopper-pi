#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRhinoPackage } from "./verify-rhino-package.mjs";

export async function reportRhinoPackageSize({ stage, target, output, webManifestPath, budgetsPath }) {
	if (output) {
		const outputRelative = relative(resolve(stage), resolve(output));
		if (outputRelative === "" || (outputRelative !== ".." && !outputRelative.startsWith(`..${sep}`) && !isAbsolute(outputRelative))) {
			throw new Error("Size report output must be outside the staged package");
		}
	}
	const webManifest = webManifestPath ? JSON.parse(await readFile(webManifestPath, "utf8")) : undefined;
	const sizeBudgets = budgetsPath ? JSON.parse(await readFile(budgetsPath, "utf8")) : undefined;
	const { sizeReport } = await verifyRhinoPackage({ stage, target, quiet: true, webManifest, sizeBudgets });
	const json = `${JSON.stringify(sizeReport, null, 2)}\n`;
	if (output) await writeFile(output, json, "utf8");
	return json;
}

function parseArguments(args) {
	const options = {};
	const flags = { "--target": "target", "--output": "output", "--web-manifest": "webManifestPath", "--budgets": "budgetsPath" };
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (flags[argument]) {
			const value = args[++index];
			if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
			options[flags[argument]] = value;
		} else if (argument.startsWith("-") || options.stage) throw new Error(`Unexpected argument: ${argument}`);
		else options.stage = argument;
	}
	if (!options.stage || !options.target) throw new Error("Usage: report-rhino-package-size.mjs --target <mac-arm64|win-x64> [--output <outside-stage.json>] [--web-manifest <vite-manifest.json>] [--budgets <json>] <stage>");
	return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	reportRhinoPackageSize(parseArguments(process.argv.slice(2))).then(json => process.stdout.write(json)).catch(error => {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = 1;
	});
}

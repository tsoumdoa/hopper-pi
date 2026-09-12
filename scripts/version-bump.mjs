#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { versionEdits } from "./release-utils.mjs";

try {
	const { values, positionals } = parseArgs({ args: process.argv.slice(2).filter((arg) => arg !== "--"), allowPositionals: true,
		options: { "dry-run": { type: "boolean" }, help: { type: "boolean", short: "h" } } });
	if (values.help || positionals.length === 0) {
		console.log("Usage: pnpm version:bump <patch|minor|major|0.3.0> [--dry-run]\nUpdates package.json and both plugin versions. Does not commit, tag, build, or publish.");
	} else {
		if (positionals.length !== 1) throw new Error("Provide exactly one version or increment.");
		const root = fileURLToPath(new URL("../", import.meta.url));
		const { current, version, edits } = versionEdits(root, positionals[0]);
		for (const { file, text } of edits) {
			if (!values["dry-run"]) writeFileSync(join(root, file), text);
			console.log(`${values["dry-run"] ? "Would update" : "Updated"} ${file}`);
		}
		console.log(`${current} -> ${version}. Commit the release changes, then run pnpm build.`);
	}
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
}

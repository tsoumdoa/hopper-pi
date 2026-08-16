import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const piImportPattern = /from\s+["']@earendil-works\/pi(?:-[^"']+)?["']/;

function collectTypeScriptFiles(directory: string): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return collectTypeScriptFiles(path);
		return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
	});
}

function findPiImports(directory: string): string[] {
	return collectTypeScriptFiles(directory)
		.filter((path) => piImportPattern.test(readFileSync(path, "utf8")))
		.map((path) => relative(srcRoot, path));
}

test("no TypeScript module imports a Pi package", () => {
	const offenders = findPiImports(srcRoot).sort();
	assert.deepEqual(offenders, []);
});

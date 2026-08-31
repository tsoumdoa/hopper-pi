#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(scriptDirectory, "..");
const sourceDirectory = join(packageRoot, "src", "host", "static");
const outputDirectory = join(packageRoot, "dist", "host", "static");

if (!existsSync(sourceDirectory)) {
	throw new Error(`Host assets were not found at ${sourceDirectory}`);
}

mkdirSync(outputDirectory, { recursive: true });
cpSync(sourceDirectory, outputDirectory, { recursive: true, force: true });

console.log(`[hopper-pi] Copied host assets to ${outputDirectory}`);

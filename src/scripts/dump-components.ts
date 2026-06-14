import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { withRequester } from "../infra/request-helpers.js";
import { fetchAllComponents } from "../tools/canvas-fetch.js";
import { shortGuidBase62 } from "../services/guid-shortener.js";
import type { GhComponentInfo } from "../types/messages.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "..", "..", "guids.json");

type ComponentEntry = {
	shortGuid: string;
	typeGuid: string;
	name: string;
	category: string;
	subcategory: string;
	description: string;
	pluginName: string;
	assemblyName: string;
};

function buildGuidMap(components: GhComponentInfo[]): Record<string, ComponentEntry> {
	const map: Record<string, ComponentEntry> = {};
	for (const c of components) {
		const shortGuid = shortGuidBase62(c.typeGuid);
		map[shortGuid] = {
			shortGuid,
			typeGuid: c.typeGuid,
			name: c.name,
			category: c.category,
			subcategory: c.subcategory,
			description: c.description,
			pluginName: c.pluginName,
			assemblyName: c.assemblyName,
		};
	}
	return map;
}

async function main() {
	console.log("Fetching all components from backend...");
	const response = await withRequester(fetchAllComponents);
	console.log(`Received ${response.components.length} components.`);

	const guidMap = buildGuidMap(response.components);
	const json = JSON.stringify(guidMap, null, "\t");

	await writeFile(OUTPUT_PATH, json, "utf-8");
	console.log(`Written to ${OUTPUT_PATH} (${Object.keys(guidMap).length} entries).`);
}

main().catch((err) => {
	console.error("Failed:", err);
	process.exit(1);
});

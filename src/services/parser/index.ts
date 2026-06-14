import { XMLParser } from "fast-xml-parser";
import { computeSubGraphs } from "../subgraph.js";
import type { ParsedGrasshopper } from "../../types/gh.js";
import type { ParsedXml } from "../../types/parser.js";
import { parseGrasshopper } from "./grasshopper.js";

export { parseGrasshopper } from "./grasshopper.js";
export { parseComponent } from "./component-parser.js";

export function buildGhJson(xmlContent: string): ParsedGrasshopper {
	const parser = new XMLParser({
		ignoreAttributes: false,
		attributeNamePrefix: "",
		parseAttributeValue: false,
		parseTagValue: false,
		trimValues: true,
		isArray: (name) => {
			return ["item", "chunk"].includes(name);
		},
	});

	const parsed = parser.parse(xmlContent) as ParsedXml;
	const result = parseGrasshopper(parsed);
	result.subGraphs = computeSubGraphs(result);
	return result;
}

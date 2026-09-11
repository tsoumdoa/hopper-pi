import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { output: { type: "string", default: "artifacts/web-bundle-report.json" } } });
const output = resolve(root, values.output);
const withinDist = relative(resolve(root, "dist"), output);
if (!isAbsolute(withinDist) && withinDist !== ".." && !withinDist.startsWith(`..${sep}`)) {
	throw new Error("Write analysis outside dist so it cannot enter the Rhino package.");
}
const result = await build({
	root: resolve(root, "web"),
	configFile: resolve(root, "vite.config.ts"),
	logLevel: "silent",
	resolve: { conditions: ["module", "browser", "production"] },
	build: { write: false },
});
if (Array.isArray(result) || !("output" in result)) throw new Error("Expected one browser build");
const chunks = result.output.filter((item) => item.type === "chunk");
const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
const initial = new Set();
function visit(fileName) {
	if (initial.has(fileName)) return;
	const chunk = byName.get(fileName);
	if (!chunk) return;
	initial.add(fileName);
	chunk.imports.forEach(visit);
}
chunks.filter((chunk) => chunk.isEntry).forEach((chunk) => visit(chunk.fileName));
const jsBytes = (chunk) => Buffer.byteLength(chunk.code);
const report = {
	schemaVersion: 1,
	note: "JavaScript bytes are final uncompressed output. Module rendered lengths are measured before final minification and do not sum to chunk bytes.",
	totals: {
		javascriptBytes: chunks.reduce((sum, chunk) => sum + jsBytes(chunk), 0),
		initialJavaScriptBytes: chunks.filter((chunk) => initial.has(chunk.fileName)).reduce((sum, chunk) => sum + jsBytes(chunk), 0),
		fontBytes: result.output.filter((item) => item.type === "asset" && item.fileName.endsWith(".woff2")).reduce((sum, asset) => sum + Buffer.byteLength(asset.source), 0),
	},
	chunks: chunks.map((chunk) => ({
		file: chunk.fileName,
		bytes: jsBytes(chunk),
		initial: initial.has(chunk.fileName),
		imports: chunk.imports,
		dynamicImports: chunk.dynamicImports,
		modules: Object.entries(chunk.modules).map(([id, module]) => ({
			id: id.replaceAll(`${root.split(sep).join("/")}/`, ""),
			renderedLength: module.renderedLength,
		})).sort((a, b) => b.renderedLength - a.renderedLength),
	})).sort((a, b) => b.bytes - a.bytes),
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Web bundle analysis: ${output}`);
console.log(JSON.stringify(report.totals, null, 2));

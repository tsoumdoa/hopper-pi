import { build } from "esbuild";
import { mkdir, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const developmentModules = resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules");
const entryNames = ["schema", "system", "compile", "value", "type", "error", "format", "guard", ""];
export const TYPEBOX_BUNDLE_VERSION = "1.3.7";

function inside(root, target) {
	const path = relative(root, target);
	return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function filesUnder(root) {
	const files = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = resolve(root, entry.name);
		if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in TypeBox build: ${path}`);
		if (entry.isDirectory()) files.push(...await filesUnder(path));
		else if (entry.isFile()) files.push(path);
		else throw new Error(`Unexpected TypeBox build entry: ${path}`);
	}
	return files;
}

/** Bundle the audited TypeBox runtime in an installed release tree, never the development install. */
export async function bundleRuntimeDependencies(nodeModules) {
	const modules = await realpath(resolve(nodeModules));
	if (modules === await realpath(developmentModules)) throw new Error("Refusing to bundle development node_modules");
	const packageRoot = await realpath(resolve(modules, "typebox"));
	if (!inside(modules, packageRoot)) throw new Error("TypeBox must be installed inside the staged node_modules");
	const buildRoot = await realpath(resolve(packageRoot, "build"));
	if (buildRoot !== resolve(packageRoot, "build")) throw new Error("TypeBox build must not be a symlink");
	const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
	if (manifest.name !== "typebox" || manifest.version !== TYPEBOX_BUNDLE_VERSION || manifest.type !== "module") {
		throw new Error(`Review TypeBox runtime bundling for version ${manifest.version}`);
	}
	const expectedExports = Object.fromEntries(entryNames.map(name => {
		const path = `./build/${name ? `${name}/` : ""}index.mjs`;
		return [name ? `./${name}` : ".", { import: path, default: path }];
	}));
	if (JSON.stringify(manifest.exports) !== JSON.stringify(expectedExports)) throw new Error("Review changed TypeBox exports before bundling");
	const originalFiles = await filesUnder(buildRoot);
	if (originalFiles.some(path => !path.endsWith(".mjs") && !path.endsWith(".d.mts"))) throw new Error("Review changed TypeBox build layout before bundling");
	const sourceFiles = originalFiles.filter(path => path.endsWith(".mjs"));
	const sources = await Promise.all(sourceFiles.map(path => readFile(path)));
	const beforeBytes = sources.reduce((total, source) => total + source.byteLength, 0);
	const entryPoints = Object.fromEntries(entryNames.map(name => [name ? `${name}/index` : "index", resolve(buildRoot, name, "index.mjs")]));
	// All public entries are built together. Independent bundles would create separate
	// format registries and make Format.Set invisible to Value.Check / Compile.
	const result = await build({
		absWorkingDir: packageRoot, entryPoints, outdir: buildRoot, bundle: true,
		splitting: true, platform: "node", target: "node22.19", format: "esm",
		outExtension: { ".js": ".mjs" }, chunkNames: "chunks/[name]-[hash]",
		minify: true, keepNames: true, legalComments: "eof", metafile: true, write: false,
	});
	if (Object.values(result.metafile.outputs).some(output => output.imports.some(item => item.external))) {
		throw new Error("Unexpected external dependency in TypeBox runtime bundle");
	}
	for (const output of result.outputFiles) {
		if (!inside(buildRoot, resolve(output.path)) || !output.path.endsWith(".mjs")) throw new Error("TypeBox bundle output escaped its staged build directory");
	}
	// Compilation and all path/layout checks finish before any mutation. Only original
	// .mjs files are replaced; declarations, package exports and the license are retained.
	for (const path of sourceFiles) {
		if (!inside(buildRoot, path)) throw new Error("TypeBox removal escaped its staged build directory");
	}
	for (const path of sourceFiles) await unlink(path);
	for (const output of result.outputFiles) {
		await mkdir(dirname(output.path), { recursive: true });
		await writeFile(output.path, output.contents);
	}
	return {
		name: "typebox", version: TYPEBOX_BUNDLE_VERSION,
		before: { files: sourceFiles.length, bytes: beforeBytes },
		after: { files: result.outputFiles.length, bytes: result.outputFiles.reduce((total, output) => total + output.contents.byteLength, 0) },
	};
}

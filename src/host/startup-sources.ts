import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

const decompress = promisify(gunzip);
type Source = { format: "module" | "commonjs"; source: string };
type LoadContext = { format?: string };
type LoadResult = { format: string; source?: unknown; shortCircuit?: boolean };
type NextLoad = (url: string, context: LoadContext) => LoadResult;
type Load = (url: string, context: LoadContext, next: NextLoad) => LoadResult;
// The repository's Node 20 typings predate this Node 22.15 API. The packaged
// runtime requires Node 22.19; older development runtimes use the normal loader.
const { registerHooks } = nodeModule as typeof nodeModule & {
	registerHooks?: (hooks: { load: Load }) => { deregister(): void };
};

export async function loadStartupSources(projectRoot: string): Promise<() => void> {
	if (!registerHooks) return () => {};
	try {
		const directory = join(projectRoot, "node_modules");
		const compressed = await readFile(join(directory, ".hopper-startup-sources.json.gz"));
		const archive = JSON.parse((await decompress(compressed, { maxOutputLength: 32 * 1024 * 1024 })).toString());
		if (archive.version !== 1 || !archive.modules || typeof archive.modules !== "object" || Array.isArray(archive.modules))
			throw new Error("Unsupported startup source archive");
		// Match Node's module resolver, including Windows short paths. The native
		// fs.promises.realpath expands 8.3 paths differently from realpathSync.
		const root = realpathSync(directory);
		const sources = new Map<string, Source>();
		for (const [path, entry] of Object.entries(archive.modules)) {
			const source = entry as Source;
			if (path.split("/").some(part => !part || part === "." || part === "..") || /[\\:]/.test(path) ||
				!/\.[cm]?js$/.test(path) || !source || typeof source.source !== "string" ||
				!["module", "commonjs"].includes(source.format)) throw new Error("Invalid startup source entry");
			sources.set(pathToFileURL(join(root, path)).href, source);
		}
		const hook = registerHooks({
			load(url, context, next) {
				const source = sources.get(url);
				if (!source || (context.format && context.format !== source.format)) return next(url, context);
				// Keep Node's resolution, original URLs, module cache and CJS semantics.
				// Only replace the source read. Native addons and assets stay on disk.
				return { ...source, shortCircuit: true };
			},
		});
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			hook.deregister();
			sources.clear();
		};
	} catch (error) {
		// The archive is an optional packaging optimization, never a startup gate.
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			process.stderr.write(`[shared-host] Startup source archive unavailable: ${String(error)}; using files\n`);
		return () => {};
	}
}

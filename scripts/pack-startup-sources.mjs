import { lstat, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const STARTUP_SOURCE_ARCHIVE = ".hopper-startup-sources.json.gz";

// Measured startup dependencies. Missing packages fall back to Node's loader;
// this list controls archive size, never which modules may be imported.
export const STARTUP_SOURCE_PACKAGES = Object.freeze([
	"@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-agent-core",
	"@earendil-works/pi-tui", "@earendil-works/pi-telemetry", "@earendil-works/chord",
	"typebox", "yaml", "semver", "highlight.js", "diff", "grok-mermaid", "cross-spawn",
	"minimatch", "chalk", "proper-lockfile", "hosted-git-info", "get-east-asian-width",
	"graceful-fs", "retry", "partial-json", "isexe", "signal-exit", "ignore", "marked",
	"brace-expansion", "balanced-match", "which", "path-key", "shebang-command", "shebang-regex",
	"lru-cache", "@mariozechner/clipboard", "@lickle/lock", "@napi-rs/keyring", "zeromq",
	"cmake-ts", "ws", "fast-xml-parser",
]);

export async function packStartupSources(nodeModules, packages = STARTUP_SOURCE_PACKAGES) {
	const root = await realpath(resolve(nodeModules));
	const development = resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules");
	if (root === await realpath(development) || (await lstat(resolve(nodeModules))).isSymbolicLink())
		throw new Error("Startup sources require a staged node_modules directory without links");
	const modules = {};
	async function walk(directory, type = "commonjs") {
		const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"));
		// Do not read through links, including linked manifests or individual files.
		for (const entry of entries) {
			if ((await lstat(join(directory, entry.name))).isSymbolicLink())
				throw new Error("Startup source input must not contain links");
		}
		if (entries.some(entry => entry.name === "package.json")) {
			const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
			type = manifest.type === "module" ? "module" : "commonjs";
		}
		for (const entry of entries) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await walk(path, type);
			else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) {
				const local = relative(root, path).replaceAll("\\", "/");
				// The consolidated SDK is the startup entry. Original CLI, workers and
				// deep imports stay on disk and continue using the ordinary loader.
				if (local.startsWith("@earendil-works/pi-coding-agent/") &&
					!local.startsWith("@earendil-works/pi-coding-agent/dist/hopper-runtime/") &&
					local !== "@earendil-works/pi-coding-agent/dist/index.js") continue;
				modules[local] = {
					format: extname(path) === ".mjs" ? "module" : extname(path) === ".cjs" ? "commonjs" : type,
					source: await readFile(path, "utf8"),
				};
			}
		}
	}
	for (const name of packages) {
		if (!/^(?:@[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(name))
			throw new Error(`Invalid startup package: ${name}`);
		const directory = join(root, name);
		const info = await lstat(directory).catch(error => { if (error.code !== "ENOENT") throw error; });
		if (!info) continue;
		if (!info.isDirectory() || await realpath(directory) !== directory)
			throw new Error("Startup sources require staged packages without links");
		await walk(directory);
	}
	const source = JSON.stringify({ version: 1, modules });
	if (Buffer.byteLength(source) > 32 * 1024 * 1024) throw new Error("Startup sources exceed the loader's 32 MiB limit");
	const archive = gzipSync(source, { level: 9 });
	// Never overwrite a file that could share an inode with another installation.
	await writeFile(join(root, STARTUP_SOURCE_ARCHIVE), archive, { flag: "wx" });
	return { files: Object.keys(modules).length, sourceBytes: Buffer.byteLength(source), bytes: archive.length };
}

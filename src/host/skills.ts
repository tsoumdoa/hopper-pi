import { mkdir, open, readdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { createReadToolDefinition, defineTool, parseFrontmatter, stripFrontmatter, type Skill } from "@earendil-works/pi-coding-agent";
import type { SkillLibrarySnapshot, SkillSummary, SkillLibraryUpdate } from "./protocol.js";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES = 500;
const inside = (root: string, path: string) => path === root || path.startsWith(root + sep);

type Entry = { summary: SkillSummary; skill: Skill };
type Document = { content: string; owner: string };
type Preferences = { folder: string; disabled: string[] };

/** A snapshot of approved Markdown bytes. Reads never fall back to the host filesystem. */
export class HostSkillLibrary {
	private entries: Entry[] = [];
	private documents = new Map<string, Document>();
	private preferences: Preferences;
	private diagnostics: string[] = [];

	constructor(private readonly projectRoot: string, private readonly preferencesPath: string, defaultFolder: string) {
		this.preferences = { folder: resolve(defaultFolder), disabled: [] };
	}

	async initialize(): Promise<void> {
		// Only create our default folder. A missing custom folder is reported in the UI.
		await mkdir(this.preferences.folder, { recursive: true });
		await this.refresh();
	}

	private async loadPreferences(): Promise<void> {
		try {
			const value = JSON.parse(await readFile(this.preferencesPath, "utf8"));
			if (typeof value.folder !== "string" || !isAbsolute(value.folder)
				|| !Array.isArray(value.disabled) || !value.disabled.every((id: unknown) => typeof id === "string")) {
				throw new Error("Invalid skill preferences");
			}
			this.preferences = value;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	refresh(): Promise<void> {
		return this.scan();
	}

	async update(update: SkillLibraryUpdate): Promise<void> {
		await this.loadPreferences();
		const next = { ...this.preferences, disabled: [...this.preferences.disabled] };
		if (update.type === "folder") {
			const folder = update.folder.startsWith("~/") ? join(homedir(), update.folder.slice(2)) : update.folder;
			if (!isAbsolute(folder)) throw new Error("Use an absolute folder path, or a path starting with ~/.");
			if (!(await stat(folder)).isDirectory()) throw new Error("Choose an existing folder.");
			next.folder = await realpath(folder);
		} else {
			if (!this.entries.some((entry) => entry.summary.id === update.id)) throw new Error("Skill no longer exists. Refresh the list.");
			const disabled = new Set(next.disabled);
			if (update.enabled) disabled.delete(update.id);
			else disabled.add(update.id);
			next.disabled = [...disabled];
		}
		await mkdir(dirname(this.preferencesPath), { recursive: true });
		const temporary = `${this.preferencesPath}.${process.pid}.tmp`;
		await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
		await rename(temporary, this.preferencesPath);
		this.preferences = next;
		await this.scan();
	}

	getSkills(): { skills: Skill[]; diagnostics: [] } {
		return { skills: this.entries.filter((entry) => entry.summary.enabled).map((entry) => entry.skill), diagnostics: [] };
	}

	snapshot(): SkillLibrarySnapshot {
		return {
			folder: this.preferences.folder,
			skills: this.entries.map(({ summary }) => summary),
			diagnostics: this.diagnostics,
		};
	}

	read(path: string, agent = true): string {
		const document = this.documents.get(resolve(path));
		const entry = document && this.entries.find((candidate) => candidate.summary.id === document.owner);
		if (!document || !entry || (agent && !entry.summary.enabled)) {
			throw new Error("Read is limited to enabled skills and their Markdown references. This file is unavailable or disabled.");
		}
		return document.content;
	}

	/** Expand before Pi can read the skill's live filesystem path. */
	expandCommand(text: string): string {
		if (!text.startsWith("/skill:")) return text;
		const space = text.indexOf(" ");
		const name = space === -1 ? text.slice(7) : text.slice(7, space);
		const entry = this.entries.find(({ summary }) => summary.enabled && summary.name === name);
		if (!entry) return text;
		const { skill } = entry;
		const body = stripFrontmatter(this.read(skill.filePath)).trim();
		const block = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
		const args = space === -1 ? "" : text.slice(space + 1).trim();
		return args ? `${block}\n\n${args}` : block;
	}

	createReadTool(cwd: string) {
		const tool = createReadToolDefinition(cwd, {
			operations: {
				access: async (path) => { this.read(path, false); },
				readFile: async (path) => Buffer.from(this.read(path)),
				detectImageMimeType: async () => undefined,
			},
		});
		return defineTool({
			...tool,
			description: "Read an enabled skill or its Markdown reference files. Only the files in the skill library are available. Supports path, offset, and limit; no access to other local files.",
			promptSnippet: "Read enabled skills and their Markdown references",
		});
	}

	private async scan(): Promise<void> {
		await this.loadPreferences();
		const entries: Entry[] = [];
		const documents = new Map<string, Document>();
		const diagnostics: string[] = [];
		const names = new Set<string>();
		let fileCount = 0;
		const fileLimit = new Error(`Library limit is ${MAX_FILES} Markdown files.`);

		const scanRoot = async (configuredRoot: string, source: "bundled" | "user") => {
			let root: string;
			try { root = await realpath(configuredRoot); }
			catch { diagnostics.push(`Folder is unavailable: ${configuredRoot}`); return; }
			if (source === "user") {
				for (const bundled of [join(this.projectRoot, "mds", "skills"), join(this.projectRoot, "mds", "reference")]) {
					const canonical = await realpath(bundled).catch(() => resolve(bundled));
					if (inside(root, canonical) || inside(canonical, root)) {
						diagnostics.push("Choose a Markdown folder separate from the bundled skills and references.");
						return;
					}
				}
			}
			const files = new Map<string, string>();
			const skillRoots: string[] = [];
			const walk = async (directory: string, depth = 0): Promise<void> => {
				if (depth > 16) { diagnostics.push(`Folder nesting limit reached: ${directory}`); return; }
				const children = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
				// Record the boundary before any reads, including ones that hit the file limit.
				if (children.some((item) => item.name === "SKILL.md")) skillRoots.push(join(directory, "SKILL.md"));
				for (const item of children) {
					try {
						if (item.name.startsWith(".")) continue;
						const path = join(directory, item.name);
						if (item.isSymbolicLink()) { diagnostics.push(`Skipped symbolic link: ${path}`); continue; }
						if (!inside(root, await realpath(path))) continue;
						if (item.isDirectory()) { await walk(path, depth + 1); continue; }
						if (!item.isFile() || extname(path).toLowerCase() !== ".md") continue;
						if (++fileCount > MAX_FILES) throw fileLimit;
						// No-follow plus a bounded read; cache only Markdown, never serve arbitrary paths.
						const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
						try {
							const info = await handle.stat();
							if (!info.isFile() || info.size > MAX_FILE_BYTES) {
								diagnostics.push(`Skipped file larger than 256 KiB: ${path}`); continue;
							}
							const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
							const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
							if (bytesRead > MAX_FILE_BYTES) continue;
							files.set(path, buffer.subarray(0, bytesRead).toString("utf8"));
						} finally { await handle.close(); }
					} catch (error) {
						if (error === fileLimit) throw error;
						diagnostics.push(`${join(directory, item.name)}: ${error instanceof Error ? error.message : String(error)}`);
					}
				}
			};
			try { await walk(root); }
			catch (error) { diagnostics.push(`${configuredRoot}: ${error instanceof Error ? error.message : String(error)}`); }

			// A SKILL.md owns its subtree; loose Markdown outside these trees becomes its own skill.
			const candidates = [...files.keys()].filter((path) => basename(path) === "SKILL.md"
				|| !skillRoots.some((skillPath) => inside(dirname(skillPath), path)));
			for (const path of candidates) {
				try {
					const { frontmatter, body } = parseFrontmatter(files.get(path)!);
					const fallback = basename(path) === "SKILL.md" ? basename(dirname(path)) : basename(path, extname(path));
					let name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : fallback.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
					if (!name) name = "markdown";
					if (names.has(name)) {
						const base = `${source}-${name}`;
						name = base;
						for (let i = 2; names.has(name); i++) name = `${base}-${i}`;
					}
					names.add(name);
					const description = typeof frontmatter.description === "string" && frontmatter.description.trim()
						? frontmatter.description.trim().slice(0, 1024)
						: body.split("\n").map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean)?.slice(0, 240) || `Instructions from ${fallback}`;
					const bundledPath = join(relative(this.projectRoot, configuredRoot), relative(root, path));
					const id = source === "bundled" ? `bundled:${bundledPath.split(sep).join("/")}` : `user:${path}`;
					const owned = basename(path) === "SKILL.md"
						? [...files.keys()].filter((file) => inside(dirname(path), file) && !skillRoots.some((other) => other !== path && inside(dirname(path), other) && inside(dirname(other), file)))
						: [path];
					const enabled = !this.preferences.disabled.includes(id);
					const manualOnly = frontmatter["disable-model-invocation"] === true;
					entries.push({
						summary: { id, name, description, path, source, enabled, manualOnly, files: owned },
						skill: { name, description, filePath: path, baseDir: dirname(path), disableModelInvocation: manualOnly,
							sourceInfo: { path, source, scope: "user", origin: "top-level", baseDir: dirname(path) } },
					});
					for (const file of owned) documents.set(file, { content: files.get(file)!, owner: id });
				} catch (error) { diagnostics.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
			}
		};
		await scanRoot(join(this.projectRoot, "mds", "skills"), "bundled");
		await scanRoot(join(this.projectRoot, "mds", "reference"), "bundled");
		await scanRoot(this.preferences.folder, "user");
		this.entries = entries;
		this.documents = documents;
		this.diagnostics = diagnostics;
	}
}

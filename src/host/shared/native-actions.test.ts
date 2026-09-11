import { lstat, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { TaskJournal } from "./journal.js";
import { SharedRegistry } from "./registry.js";
import type { SharedNativeRuntime } from "./native-runtime.js";
import { createNativeActionAdapters, inspectDestination } from "./native-actions.js";

it("preflights a pre-close save in missing directories without creating them", async () => {
	const directory = await mkdtemp(join(tmpdir(), "hopper-save-preflight-"));
	const journal = new TaskJournal(":memory:");
	try {
		const native = {
			pruneDeadAttachments: () => {},
			getClient: () => ({ call: async () => ({ result: { class: "completed", data: {
				activeDocumentId: "doc", capabilities: { multiDocument: false },
				documents: [{ documentId: "doc", path: null, stateToken: "observed", isModified: true }],
			} } }) }),
		} as unknown as SharedNativeRuntime;
		const savePath = join(directory, "project", "models", "saved.3dm");
		const { documents } = createNativeActionAdapters(native, journal, new SharedRegistry(journal));
		const result = await documents.preflight({ requestId: "new", taskId: "task", lifecycleInstanceId: "life",
			kind: "rhino", action: "new", modifiedPolicy: "save", savePath, createDirectories: true });
		expect(result.arguments?.affectedDocuments).toMatchObject([{ documentId: "doc", savePath, createDirectories: true }]);
		expect(result.arguments?.expectedDestinations).toEqual([{ path: join(await realpath(directory), "project", "models", "saved.3dm"), exists: false }]);
		expect(result.destinations).toHaveLength(1);
		expect(result.destinations[0].baseline).toEqual({ exists: false });
		await expect(lstat(join(directory, "project"))).rejects.toMatchObject({ code: "ENOENT" });
	} finally { journal.close(); await rm(directory, { recursive: true, force: true }); }
});

it.skipIf(process.platform === "win32")("reserves the same missing destination through existing directory aliases", async () => {
	const directory = await mkdtemp(join(tmpdir(), "hopper-save-alias-"));
	try {
		await mkdir(join(directory, "real"));
		await symlink(join(directory, "real"), join(directory, "alias"), "dir");
		const direct = await inspectDestination(join(directory, "real", "missing", "nested", "saved.3dm"));
		const alias = await inspectDestination(join(directory, "alias", "missing", "nested", "saved.3dm"));
		expect(alias).toEqual(direct);
		expect(alias.baseline).toEqual({ exists: false });
		await expect(lstat(join(directory, "real", "missing"))).rejects.toMatchObject({ code: "ENOENT" });
	} finally { await rm(directory, { recursive: true, force: true }); }
});

it.skipIf(process.platform === "win32")("rejects dangling directory links instead of treating them as missing folders", async () => {
	const directory = await mkdtemp(join(tmpdir(), "hopper-save-dangling-"));
	try {
		await symlink(join(directory, "missing"), join(directory, "alias"), "dir");
		await expect(inspectDestination(join(directory, "alias", "nested", "saved.3dm"))).rejects.toMatchObject({ code: "ENOENT" });
	} finally { await rm(directory, { recursive: true, force: true }); }
});

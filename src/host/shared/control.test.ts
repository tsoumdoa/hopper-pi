import { afterEach, describe, expect, it } from "vitest";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:net";
import { SharedHostControl } from "./control.js";
const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
	for (const server of servers.splice(0))
		if (server.listening)
			await new Promise<void>((resolve) => server.close(() => resolve()));
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "hopper-control-"));
	roots.push(root);
	return {
		root,
		control: new SharedHostControl(join(root, "control")),
		data: join(root, "data"),
	};
}
describe("shared host control", () => {
	it("serializes first startup and retains storage, endpoint and browser credentials", async () => {
		const { root, control, data } = fixture();
		const other = new SharedHostControl(join(root, "control"));
		const [a, b] = await Promise.all([
			control.initialize({ defaultDataDirectory: data }),
			other.initialize({ defaultDataDirectory: join(root, "other") }),
		]);
		expect(a).toEqual(b);
		if (process.platform !== "win32")
			expect(statSync(join(root, "control", "control.json")).mode & 0o777).toBe(
				0o600,
			);
		await expect(
			other.initialize({ defaultDataDirectory: data, dataDirectory: root }),
		).rejects.toThrow("conflict");
		expect(
			(await control.initialize({ defaultDataDirectory: "ignored" }))
				.browserCredential,
		).toBe(a.browserCredential);
	});
	it("refuses to replace missing or changed storage", async () => {
		const { control, data } = fixture();
		await control.initialize({ defaultDataDirectory: data });
		rmSync(join(data, "journal.sqlite"));
		await expect(
			control.initialize({ defaultDataDirectory: data }),
		).rejects.toThrow("journal is missing");
		rmSync(data, { recursive: true });
		await expect(
			control.initialize({ defaultDataDirectory: data }),
		).rejects.toThrow("missing");
	});
	it("does not initialize an empty replacement database during identity verification", async () => {
		const { control, data } = fixture();
		await control.initialize({ defaultDataDirectory: data });
		writeFileSync(join(data, "journal.sqlite"), "");
		await expect(
			control.initialize({ defaultDataDirectory: data }),
		).rejects.toThrow();
		expect(statSync(join(data, "journal.sqlite")).size).toBe(0);
	});
	it("fences stale stops, starts and publication", async () => {
		const { control, data } = fixture();
		const initial = await control.initialize({ defaultDataDirectory: data });
		const stopped = await control.setDesiredState("stopped", initial.revision);
		expect(
			(await control.initialize({ defaultDataDirectory: data })).desiredState,
		).toBe("stopped");
		const server = createServer();
		servers.push(server);
		await expect(
			control.acquireOwnership(server, initial.revision),
		).rejects.toThrow("intent changed");
		const running = await control.initialize({
			defaultDataDirectory: data,
			explicitStart: true,
		});
		await expect(
			control.setDesiredState("stopped", stopped.revision),
		).rejects.toThrow("Stale");
		await expect(
			control.publish({
				...initial,
				hostEpoch: "epoch",
				pid: 1,
				processStartIdentity: "start",
				protocolVersion: 2,
				schemaVersion: 1,
				registrationToken: "private",
			}),
		).rejects.toThrow("does not match");
		expect(running.revision).toBe(3);
	});
	it("keeps a hung owner exclusive and never chooses a fallback endpoint", async () => {
		const { control, data } = fixture();
		const state = await control.initialize({ defaultDataDirectory: data });
		const a = createServer();
		const b = createServer();
		servers.push(a, b);
		await control.acquireOwnership(a, state.revision);
		await expect(control.acquireOwnership(b, state.revision)).rejects.toThrow(
			"occupied",
		);
		expect((await control.snapshot())!.endpointPort).toBe(state.endpointPort);
		await new Promise<void>((resolve) => a.close(() => resolve()));
		await control.acquireOwnership(b, state.revision);
	});
	it("fails closed on corrupt existing control", async () => {
		const { root, control, data } = fixture();
		await control.initialize({ defaultDataDirectory: data });
		expect(
			readFileSync(join(root, "control", "control.json"), "utf8"),
		).toContain("browserCredential");
		writeFileSync(join(root, "control", "control.json"), "{}");
		await expect(
			control.initialize({ defaultDataDirectory: data, explicitStart: true }),
		).rejects.toThrow("Invalid shared control");
	});
});

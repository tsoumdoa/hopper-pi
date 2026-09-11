import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { expect, it } from "vitest";

it("serves loading assets and authenticates the browser before a blocking runtime import", async () => {
	const dir = mkdtempSync(join(tmpdir(), "hopper-startup-gate-"));
	writeFileSync(join(dir, "index.html"), '<html>Loading Hopper<script src="/loading.js"></script></html>');
	writeFileSync(join(dir, "loading.js"), 'window.loading = true;');
	const serverPath = fileURLToPath(new URL("./browser-server.ts", import.meta.url));
	const gatePath = fileURLToPath(new URL("./startup-gate.ts", import.meta.url));
	// A separate process is essential: the deliberately synchronous module must
	// block the host event loop without blocking the simulated launcher/browser.
	const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
		import { pathToFileURL } from "node:url";
		const { createSharedBrowserServer } = await import(pathToFileURL(${JSON.stringify(serverPath)}));
		const { createStartupGate } = await import(pathToFileURL(${JSON.stringify(gatePath)}));
		const gate = createStartupGate(10000);
		const server = createSharedBrowserServer({
			staticDir: ${JSON.stringify(dir)}, browserCredential: "browser-secret",
			registrationCredential: "launcher-secret",
			startup: { hostEpoch: "test-epoch", ...gate },
			backend: { snapshot() { throw new Error("initializing"); }, command: async () => {}, subscribe: () => () => {} },
			health: () => ({ listening: true, ready: false }),
		});
		await new Promise(resolve => server.server.listen(0, "127.0.0.1", resolve));
		console.log(JSON.stringify({ stage: "listening", port: server.server.address().port }));
		await gate.wait();
		console.log(JSON.stringify({ stage: "importing", at: Date.now() }));
		await import("data:text/javascript," + encodeURIComponent("Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);"));
		console.log(JSON.stringify({ stage: "imported", at: Date.now() }));
		await server.close();
	`], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
	const stages = new Map<string, any>();
	const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void }>();
	let output = "";
	let errors = "";
	child.stderr.on("data", data => { errors += data; });
	child.stdout.on("data", data => {
		output += data;
		let newline: number;
		while ((newline = output.indexOf("\n")) >= 0) {
			const event = JSON.parse(output.slice(0, newline));
			output = output.slice(newline + 1);
			stages.set(event.stage, event);
			pending.get(event.stage)?.resolve(event);
			pending.delete(event.stage);
		}
	});
	const stage = (name: string): Promise<any> => stages.has(name)
		? Promise.resolve(stages.get(name)) : new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(name);
				reject(new Error(`Timed out waiting for ${name}: ${errors}`));
			}, 5_000);
			pending.set(name, {
				resolve: value => { clearTimeout(timer); resolve(value); },
				reject: error => { clearTimeout(timer); reject(error); },
			});
		});
	const exited = new Promise<number | null>(resolve => child.once("exit", resolve));
	child.once("exit", code => {
		for (const waiter of pending.values()) waiter.reject(new Error(`Host exited (${code}): ${errors}`));
		pending.clear();
	});
	let socket: WebSocket | undefined;
	try {
		const { port } = await stage("listening");
		const origin = `http://127.0.0.1:${port}`;
		expect((await fetch(`${origin}/api/shared/health`)).ok).toBe(true);
		expect((await fetch(`${origin}/api/shared/browser-ready`, {
			method: "POST", headers: { Authorization: "Bearer launcher-secret", "X-Hopper-Host-Epoch": "test-epoch" },
		})).status).toBe(204);
		expect(await (await fetch(origin)).text()).toContain("Loading Hopper");
		expect(await (await fetch(`${origin}/loading.js`)).text()).toContain("window.loading");
		expect(stages.has("importing")).toBe(false);
		socket = new WebSocket(`ws://127.0.0.1:${port}/ws-shared`, { origin });
		await new Promise<void>(resolve => socket!.once("open", resolve));
		socket.send(JSON.stringify({ type: "authenticate", token: "browser-secret" }));
		const importing = await stage("importing");
		const imported = await stage("imported");
		expect(imported.at - importing.at).toBeGreaterThanOrEqual(450);
		expect(await exited, errors).toBe(0);
	} finally {
		socket?.terminate();
		child.kill();
		await exited;
		rmSync(dir, { recursive: true, force: true });
	}
}, 15_000);

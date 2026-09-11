import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const benchmark = join(dirname(fileURLToPath(import.meta.url)), "benchmark-host-startup.mjs");

async function fixture(ready) {
	const root = await mkdtemp(join(tmpdir(), "hopper-benchmark-test-"));
	await mkdir(join(root, "static"));
	await writeFile(join(root, "static", "index.html"), "<!doctype html><title>Fixture</title>");
	const entry = join(root, "index.mjs");
	const observed = join(root, "observed.json");
	await writeFile(entry, `
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, relative } from "node:path";
import { createServer } from "node:http";
assert.equal(homedir(), userInfo().homedir);
assert.match(homedir(), /hopper-startup-benchmark-/);
assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
assert.equal(process.env.HOPPER_PI_AUTH_PATH, undefined);
const options = process.argv.slice(2);
const auth = options[options.indexOf("--auth-path") + 1];
assert.equal(relative(homedir(), auth), "auth.json");
writeFileSync(${JSON.stringify(observed)}, JSON.stringify({ home: homedir(), pid: process.pid, entry: import.meta.url }));
const control = join(homedir(), ".hopper", "shared-control");
mkdirSync(control, { recursive: true });
let discovery;
const server = createServer((_request, response) => response.end(JSON.stringify({ ...discovery, listening: true, ready: ${ready} })));
server.listen(0, "127.0.0.1", () => {
 discovery = { pid: process.pid, hostEpoch: "fixture", endpointPort: server.address().port };
 writeFileSync(join(control, "discovery.json"), JSON.stringify(discovery));
 process.stderr.write("[shared-host] startup: browser listening; loading runtime modules (10 ms elapsed)\\n");
 process.stderr.write("[shared-host] startup: opening journal and rebuilding browser history if needed (20 ms elapsed)\\n");
});
`);
	return { root, entry, observed };
}

for (const [ready, copy] of [[true, false], [false, false], [true, true]]) {
	test(`isolates paths and credentials and cleans up after ${ready ? "readiness" : "timeout"}${copy ? " from a fresh package path" : ""}`, async () => {
		const f = await fixture(ready);
		try {
			const child = spawnSync(process.execPath, [benchmark, "--entry", f.entry, "--runs", "1", "--timeout-ms", "1500",
				...(copy ? ["--copy-root", f.root] : [])], {
				encoding: "utf8", timeout: 10000, windowsHide: true,
				env: { ...process.env, ANTHROPIC_API_KEY: "must-not-reach-host", HOPPER_PI_AUTH_PATH: "must-not-reach-host" },
			});
			assert.ifError(child.error);
			if (ready) {
				assert.equal(child.status, 0, child.stderr);
				const result = JSON.parse(child.stdout).results[0];
				assert.ok(result.firstHealthMs > 0);
				assert.ok(result.readyMs >= result.firstHealthMs);
				assert.equal(result.runtimeModulesMs, 10);
			} else {
				assert.notEqual(child.status, 0);
				assert.match(child.stderr, /did not become ready/);
			}
			const observed = JSON.parse(await readFile(f.observed, "utf8"));
			if (copy) {
				assert.match(observed.entry, /hopper-startup-benchmark-.*\/package\/index.mjs$/);
				assert.ok(existsSync(f.entry), "original package must remain intact");
			}
			assert.equal(existsSync(observed.home), false, "isolated home must be removed");
			assert.throws(() => process.kill(observed.pid, 0), { code: "ESRCH" }, "benchmark child must be stopped");
		} finally {
			await rm(f.root, { recursive: true, force: true });
		}
	});
}

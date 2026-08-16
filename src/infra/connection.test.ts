import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
	clearConnectionCache,
	connectionProfileDirectory,
} from "./connection.js";

test("copies a legacy hopper-pi profile into hoppercode without printing the token", async () => {
	const root = await mkdtemp(join(tmpdir(), "hopper-profile-"));
	const previousXdg = process.env.XDG_DATA_HOME;
	process.env.XDG_DATA_HOME = root;
	delete process.env.HOPPER_CONNECTION_PROFILE;
	clearConnectionCache();
	try {
		const legacyDir = join(root, "hopper-pi");
		await mkdir(legacyDir, { recursive: true });
		await writeFile(
			join(legacyDir, "connection.json"),
			JSON.stringify({
				pubEndpoint: "tcp://127.0.0.1:5555",
				pushEndpoint: "tcp://127.0.0.1:5556",
				reqEndpoint: "tcp://127.0.0.1:5557",
				token: "secret-token-value",
			}),
		);
		await writeFile(join(legacyDir, "connection-token"), "secret-token-value\n");

		const currentDir = connectionProfileDirectory();
		assert.equal(currentDir, join(root, "hoppercode"));
		const copied = JSON.parse(await readFile(join(currentDir, "connection.json"), "utf8")) as {
			token?: string;
		};
		assert.equal(copied.token, "secret-token-value");
		assert.equal(await readFile(join(currentDir, "connection-token"), "utf8"), "secret-token-value\n");
	} finally {
		if (previousXdg === undefined) delete process.env.XDG_DATA_HOME;
		else process.env.XDG_DATA_HOME = previousXdg;
		clearConnectionCache();
	}
});

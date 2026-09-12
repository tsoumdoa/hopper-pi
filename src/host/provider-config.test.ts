import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { addCustomProvider, type CustomProviderInput } from "./provider-config.js";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const config: CustomProviderInput = {
	id: "custom-local",
	baseUrl: "http://localhost:11434/v1",
	api: "openai-completions",
	modelIds: ["local-model"],
	noAuth: true,
};
async function directory() {
	const dir = await mkdtemp(join(tmpdir(), "hopper-providers-"));
	dirs.push(dir);
	return dir;
}

it("loads a keyless endpoint in a fresh task runtime without changing other definitions", async () => {
	const dir = await directory();
	const path = join(dir, "models.json");
	await writeFile(
		path,
		"\uFEFF// Existing Pi provider configuration\n" +
			JSON.stringify({
				providers: {
					existing: {
						baseUrl: "http://localhost:1234/v1",
						api: "openai-completions",
						apiKey: "dummy",
						models: [{ id: "other" }],
					},
				},
			}),
	);
	await addCustomProvider(path, config);
	expect(await readFile(path, "utf8")).toContain("// Existing Pi provider configuration");
	const runtime = await ModelRuntime.create({
		authPath: join(dir, "auth.json"),
		modelsPath: path,
		modelsStorePath: join(dir, "models-store.json"),
	});
	expect(runtime.getAvailableSnapshot().some((m) => m.provider === config.id && m.id === "local-model")).toBe(
		true,
	);
	expect(runtime.getModel("existing", "other")).toBeDefined();
});

it("makes a custom provider available in a fresh runtime through shared Pi auth", async () => {
	const dir = await directory();
	const path = join(dir, "models.json");
	await addCustomProvider(path, { ...config, noAuth: false, apiKey: "test-secret-key" });
	const options = { authPath: join(dir, "auth.json"), modelsPath: path };
	const admin = await ModelRuntime.create(options);
	await admin.login(config.id, "api_key", { prompt: async () => "test-secret-key", notify: () => {} });
	const task = await ModelRuntime.create(options);
	expect(task.getAvailableSnapshot().some((m) => m.provider === config.id)).toBe(true);
});

it("preserves both providers when additions run concurrently", async () => {
	const path = join(await directory(), "models.json");
	await Promise.all([
		addCustomProvider(path, config),
		addCustomProvider(path, { ...config, id: "custom-other" }),
	]);
	expect(Object.keys(JSON.parse(await readFile(path, "utf8")).providers)).toHaveLength(2);
});

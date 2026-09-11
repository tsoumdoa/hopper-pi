import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const run = promisify(execFile);

// Use fresh processes: a cached or mocked SDK would hide accidental eager imports.
it.each(["../src/host/index.ts", "../src/host/shared/main.ts"])(
	"loads %s without the AI runtime on the browser startup path",
	async relative => {
		const entry = new URL(relative, import.meta.url).href;
		const script = `
			import { registerHooks } from "node:module";
			registerHooks({ resolve(specifier, context, next) {
				if (specifier.startsWith("@earendil-works/pi-") || /(?:pi-runtime|pi-driver|document-tool-policy)\\.[jt]s$/.test(specifier))
					throw new Error("Eager AI dependency before browser readiness: " + specifier);
				return next(specifier, context);
			} });
			await import(${JSON.stringify(entry)});
			process.stdout.write("loaded");
		`;
		const { stdout } = await run(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
			windowsHide: true,
			timeout: 10_000,
		});
		expect(stdout).toBe("loaded");
	},
	15_000,
);

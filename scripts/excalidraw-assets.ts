import { readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { Plugin } from "vite";

// Hopper's editor has an English UI and no language selector. This affects
// translated controls only. Keep every drawing font, including CJK fallbacks.
// Remove this plugin when adding localized editor controls.
export function excalidrawEnglishUi(): Plugin {
	const distributions = dirname(dirname(createRequire(import.meta.url).resolve("@excalidraw/excalidraw")));
	const entries = new Map(["dev", "prod"].map((distribution) => {
		const locales = join(distributions, distribution, "locales");
		const english = readdirSync(locales).filter((name) => /^en-[\w-]+\.js$/.test(name));
		if (english.length !== 1) throw new Error("Excalidraw's English locale layout changed; review the UI locale optimization.");
		return [realpathSync(join(distributions, distribution, "index.js")), join(locales, english[0])];
	}));
	return {
		name: "excalidraw-english-ui",
		apply: "build",
		enforce: "pre",
		resolveId(source, importer) {
			if (!importer || !/^\.\/locales\/[^/]+\.js$/.test(source)) return null;
			return entries.get(resolve(importer)) ?? null;
		},
	};
}

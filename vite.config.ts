import { createReadStream, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Serve the editor's fonts locally in development and include them in packaged builds.
function excalidrawFonts(): Plugin {
	const fonts = join(dirname(createRequire(import.meta.url).resolve("@excalidraw/excalidraw")), "fonts");
	return {
		name: "excalidraw-fonts",
		configureServer(server) {
			server.middlewares.use("/excalidraw/fonts", (request, response, next) => {
				const path = resolve(fonts, `.${(request.url ?? "").split("?")[0]}`);
				if (!path.startsWith(`${fonts}${sep}`) || !path.endsWith(".woff2")) return next();
				const stream = createReadStream(path);
				stream.on("error", () => { response.statusCode = 404; response.end(); });
				response.setHeader("Content-Type", "font/woff2");
				stream.pipe(response);
			});
		},
		generateBundle() {
			for (const file of readdirSync(fonts, { recursive: true, withFileTypes: true })) {
				if (!file.isFile() || !file.name.endsWith(".woff2")) continue;
				const path = join(file.parentPath, file.name);
				this.emitFile({ type: "asset", fileName: `excalidraw/fonts/${relative(fonts, path).split(sep).join("/")}`, source: readFileSync(path) });
			}
		},
	};
}

// Match the host's fixed per-user endpoint without copying its browser credential.
function hostProxyTarget(): string {
	if (process.env.HOPPER_UI_PROXY_TARGET) return process.env.HOPPER_UI_PROXY_TARGET;
	try {
		const state: unknown = JSON.parse(readFileSync(join(homedir(), ".hopper", "shared-control", "control.json"), "utf8"));
		const port = state && typeof state === "object" && "endpointPort" in state ? state.endpointPort : undefined;
		if (typeof port === "number" && Number.isSafeInteger(port) && port > 0 && port <= 65535) return `http://127.0.0.1:${port}`;
	} catch {
		// Mock/build workflows need no live host. Real requests fail closed below.
	}
	return "http://127.0.0.1:1";
}

const proxyTarget = hostProxyTarget();

export default defineConfig({
	plugins: [react(), tailwindcss(), excalidrawFonts()],
	root: "web",
	base: "/",
	build: {
		outDir: resolve(import.meta.dirname, "dist/host/static"),
		emptyOutDir: true,
		assetsDir: "assets",
		sourcemap: false,
	},
	server: {
		proxy: {
			"/api": proxyTarget,
			"/ws": { target: proxyTarget, ws: true },
		},
	},
});

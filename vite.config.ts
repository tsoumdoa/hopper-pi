import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
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
			"/api": process.env.HOPPER_UI_PROXY_TARGET ?? "http://127.0.0.1:19777",
			"/ws": { target: process.env.HOPPER_UI_PROXY_TARGET ?? "ws://127.0.0.1:19777", ws: true },
		},
	},
});

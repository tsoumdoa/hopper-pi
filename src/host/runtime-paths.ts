import { fileURLToPath } from "node:url";

// Keep this module at dist/host/runtime-paths.js in both the standalone and
// bundled Rhino builds. Callers can move without changing packaged asset paths.
export function hostProjectRoot(): string {
	return fileURLToPath(new URL("../../", import.meta.url));
}

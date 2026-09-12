import { normalizePackagePath, PACKAGE_MANIFEST_NAME } from "./rhino-package-rules.mjs";

const WEB_PREFIX = "runtime/host/dist/host/static/";
const DEPENDENCY_PREFIX = "runtime/host/node_modules/";

export function packageSizeCategory(inputPath) {
	const path = normalizePackagePath(inputPath);
	if (path === PACKAGE_MANIFEST_NAME || (!path.includes("/") && /\.yak$/i.test(path))) return null;
	if (path.startsWith(WEB_PREFIX)) {
		if (/\.[cm]?js$/i.test(path)) return "webJavaScript";
		if (/\.(woff2?|ttf|otf)$/i.test(path)) return "webFonts";
		if (/\.css$/i.test(path)) return "webCss";
		return "webOther";
	}
	if (path.startsWith(DEPENDENCY_PREFIX)) return "nodeDependencies";
	if (path.startsWith("runtime/host/dist/")) return "nodeCode";
	return "otherRuntime";
}

export function summarizePackageSize(files, { target, yakFiles = [], nativePaths = [], webManifest } = {}) {
	const categories = Object.fromEntries(["nodeCode", "nodeDependencies", "webJavaScript", "webFonts", "webCss", "webOther", "otherRuntime"].map(key => [key, 0]));
	const packages = new Map();
	const sizes = new Map();
	const natives = new Set(nativePaths);
	let nativeBinaryBytes = 0;
	for (const file of files) {
		const path = normalizePackagePath(file.path);
		const category = packageSizeCategory(path);
		if (!category) continue;
		categories[category] += file.size;
		sizes.set(path, file.size);
		if (natives.has(path)) nativeBinaryBytes += file.size;
		if (category === "nodeDependencies") {
			const parts = path.slice(DEPENDENCY_PREFIX.length).split("/");
			const name = parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
			packages.set(name, (packages.get(name) ?? 0) + file.size);
		}
	}
	let initialWebJavaScriptBytes = null;
	if (webManifest) {
		const visited = new Set();
		const initialFiles = new Set();
		function visit(key) {
			if (visited.has(key)) return;
			visited.add(key);
			const entry = webManifest[key];
			if (!entry) throw new Error(`Web manifest references missing entry: ${key}`);
			if (/\.[cm]?js$/i.test(entry.file)) initialFiles.add(WEB_PREFIX + entry.file);
			for (const imported of entry.imports ?? []) visit(imported);
		}
		for (const [key, entry] of Object.entries(webManifest)) if (entry.isEntry) visit(key);
		if (!visited.size) throw new Error("Web manifest has no entry points");
		initialWebJavaScriptBytes = 0;
		for (const path of initialFiles) {
			if (!sizes.has(path)) throw new Error(`Web manifest asset missing from package: ${path}`);
			initialWebJavaScriptBytes += sizes.get(path);
		}
	}
	return {
		target,
		stagedBytes: Object.values(categories).reduce((sum, bytes) => sum + bytes, 0),
		categories,
		// Native bytes overlap the categories above, and must not be added to stagedBytes.
		nativeBinaryBytes,
		initialWebJavaScriptBytes,
		dependencyPackages: [...packages].map(([name, bytes]) => ({ name, bytes })).sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name)),
		yakArchives: [...yakFiles].sort((a, b) => a.path.localeCompare(b.path)),
	};
}

export function validateSizeBudgets(report, budgets = {}) {
	const metrics = { ...report.categories, stagedBytes: report.stagedBytes, initialWebJavaScriptBytes: report.initialWebJavaScriptBytes, nativeBinaryBytes: report.nativeBinaryBytes };
	const errors = [];
	for (const [metric, maximum] of Object.entries(budgets)) {
		if (!(metric in metrics) || !Number.isFinite(maximum) || maximum < 0) throw new Error(`Invalid size budget: ${metric}`);
		if (metrics[metric] === null) errors.push(`${metric}: cannot enforce budget without a web manifest`);
		else if (metrics[metric] > maximum) errors.push(`${metric}: ${metrics[metric]} bytes exceeds ${maximum} byte budget`);
	}
	return errors;
}

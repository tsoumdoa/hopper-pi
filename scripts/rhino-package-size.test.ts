import { describe, expect, it } from "vitest";
import { packageSizeCategory, summarizePackageSize, validateSizeBudgets } from "./rhino-package-size.mjs";
import { reportRhinoPackageSize } from "./report-rhino-package-size.mjs";

const web = "runtime/host/dist/host/static/";

describe("Rhino package size accounting", () => {
	it("partitions browser assets from Node code and dependencies", () => {
		const files = [
			{ path: `${web}assets/index.js`, size: 10 },
			{ path: `${web}fonts/font.woff2`, size: 20 },
			{ path: `${web}assets/index.css`, size: 3 },
			{ path: `${web}index.html`, size: 4 },
			{ path: "runtime/host/dist/host/index.js", size: 5 },
			{ path: "runtime/host/node_modules/@scope/addon/addon.node", size: 6 },
			{ path: "runtime/host/node_modules/@scope/addon/index.js", size: 7 },
			{ path: "runtime/host/node_modules/plain/index.js", size: 8 },
			{ path: "Hopper.Core.dll", size: 9 },
			{ path: "package.yak", size: 1000 },
			{ path: "rhino-package-manifest.json", size: 2000 },
		];
		const report = summarizePackageSize(files, { nativePaths: [files[5].path], yakFiles: [{ path: "package.yak", size: 1000 }] });
		expect(report.categories).toEqual({ webJavaScript: 10, webFonts: 20, webCss: 3, webOther: 4, nodeCode: 5, nodeDependencies: 21, otherRuntime: 9 });
		expect(report.stagedBytes).toBe(72);
		expect(report.nativeBinaryBytes).toBe(6);
		expect(report.dependencyPackages).toEqual([{ name: "@scope/addon", bytes: 13 }, { name: "plain", bytes: 8 }]);
		expect(report.yakArchives).toEqual([{ path: "package.yak", size: 1000 }]);
		expect(report.initialWebJavaScriptBytes).toBeNull();
		expect(packageSizeCategory("runtime\\host\\dist\\host\\static\\a.js")).toBe("webJavaScript");
	});

	it("counts shared static imports once and excludes dynamic imports from initial JS", () => {
		const files = ["main", "shared", "editor"].map((name, index) => ({ path: `${web}${name}.js`, size: (index + 1) * 10 }));
		const webManifest = {
			index: { file: "main.js", isEntry: true, imports: ["shared"], dynamicImports: ["editor"] },
			shared: { file: "shared.js", imports: ["index"] },
			editor: { file: "editor.js", imports: ["shared"] },
		};
		expect(summarizePackageSize(files, { webManifest }).initialWebJavaScriptBytes).toBe(30);
		expect(() => summarizePackageSize(files.slice(0, 1), { webManifest })).toThrow("asset missing");
	});

	it("fails category regressions even when the total stays within budget", () => {
		const report = summarizePackageSize([{ path: `${web}font.woff2`, size: 11 }]);
		expect(validateSizeBudgets(report, { stagedBytes: 100, webFonts: 10 })).toEqual(["webFonts: 11 bytes exceeds 10 byte budget"]);
		expect(validateSizeBudgets(report, { webFonts: 11 })).toEqual([]);
		expect(validateSizeBudgets(report, { initialWebJavaScriptBytes: 100 })[0]).toContain("without a web manifest");
		expect(() => validateSizeBudgets(report, { typo: 100 })).toThrow("Invalid size budget");
	});

	it("refuses to put reports in the shipped payload", async () => {
		await expect(reportRhinoPackageSize({ stage: "/tmp/stage", target: "mac-arm64", output: "/tmp/stage/report.json" })).rejects.toThrow("outside the staged package");
	});
});

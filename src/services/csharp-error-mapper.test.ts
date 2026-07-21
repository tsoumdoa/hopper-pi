import { describe, expect, it } from "vitest";
import {
	buildCompileErrorHints,
	extractCompileLine,
	formatPatchHint,
	locateCompileError,
} from "./csharp-error-mapper.js";
import { assembleCsharpScript } from "./csharp-script-assembler.js";
import type { CanvasError } from "../types/messages.js";

const SCRIPT = assembleCsharpScript({
	references: ["System", "System.Drawing", "Rhino.Geometry", "Grasshopper.Kernel.Types"],
	runScript: [
		"private void RunScript(object attr, ref object outPt)",
		"{",
		"  Point3d a = ToPoint(attr);",
		"  outPt = a;",
		"}",
	].join("\n"),
	helpers: [
		"private Point3d ToPoint(object o)",
		"{",
		"  if (o is Point3d p) return p;",
		"  if (o is Point pt) return pt.Location;",
		"  return Point3d.Origin;",
		"}",
	].join("\n"),
});

function fullLineOf(needle: string): number {
	const idx = SCRIPT.split("\n").findIndex((l) => l.includes(needle));
	expect(idx).toBeGreaterThanOrEqual(0);
	return idx + 1;
}

describe("extractCompileLine", () => {
	it("parses [line:col] diagnostics", () => {
		expect(
			extractCompileLine("'Point' is an ambiguous reference between 'System.Drawing.Point' and 'Rhino.Geometry.Point' [117:16]"),
		).toBe(117);
	});

	it("returns null without a location", () => {
		expect(extractCompileLine("Object reference not set to an instance")).toBeNull();
	});

	it("rejects non-positive lines", () => {
		expect(extractCompileLine("bad [0:4]")).toBeNull();
	});
});

describe("locateCompileError", () => {
	it("maps a helpers line to helpers scope", () => {
		const loc = locateCompileError(SCRIPT, fullLineOf("o is Point pt"));
		expect(loc).toEqual({
			scope: "helpers",
			line: 4,
			text: "if (o is Point pt) return pt.Location;",
		});
	});

	it("maps a RunScript body line to runScriptBody scope", () => {
		const loc = locateCompileError(SCRIPT, fullLineOf("ToPoint(attr)"));
		expect(loc?.scope).toBe("runScriptBody");
		// runScriptBody keeps its leading blank line, matching patchCode coordinates.
		expect(loc?.line).toBe(2);
		expect(loc?.text).toBe("Point3d a = ToPoint(attr);");
	});

	it("returns null for out-of-range lines", () => {
		expect(locateCompileError(SCRIPT, 9999)).toBeNull();
		expect(locateCompileError(SCRIPT, 0)).toBeNull();
	});

	it("falls back to full scope for non-C# code (Python)", () => {
		const python = "import rhinoscriptsyntax as rs\nx = undefined_name\n";
		const loc = locateCompileError(python, 2);
		expect(loc).toEqual({ scope: "full", line: 2, text: "x = undefined_name" });
	});
});

describe("formatPatchHint", () => {
	it("includes scope, line, and source snippet", () => {
		const hint = formatPatchHint({ scope: "helpers", line: 4, text: "if (o is Point pt) return pt.Location;" });
		expect(hint).toContain("scope=helpers line=4");
		expect(hint).toContain("if (o is Point pt) return pt.Location;");
	});
});

describe("buildCompileErrorHints", () => {
	const compileError = (componentId: string, line: number): CanvasError => ({
		componentId,
		componentNickName: "Script",
		level: "error",
		text: `'Point' is ambiguous [${line}:16]`,
	});

	it("builds hints keyed by error index, caching code per component", async () => {
		let fetches = 0;
		const errors: CanvasError[] = [
			compileError("comp-a", fullLineOf("o is Point pt")),
			compileError("comp-a", fullLineOf("ToPoint(attr)")),
			{ componentId: "comp-a", componentNickName: "Script", level: "warning", text: "warn [3:1]" },
			{ componentId: "comp-b", componentNickName: "Other", level: "error", text: "no location here" },
		];
		const hints = await buildCompileErrorHints(errors, async () => {
			fetches++;
			return SCRIPT;
		});

		expect(fetches).toBe(1);
		expect(hints.get(0)).toContain("scope=helpers line=4");
		expect(hints.get(1)).toContain("scope=runScriptBody line=2");
		expect(hints.has(2)).toBe(false); // warnings skipped
		expect(hints.has(3)).toBe(false); // no [line:col]
	});

	it("skips components whose code cannot be fetched", async () => {
		const errors = [compileError("comp-x", 5)];
		const hints = await buildCompileErrorHints(errors, async () => {
			throw new Error("not a script component");
		});
		expect(hints.size).toBe(0);
	});
});

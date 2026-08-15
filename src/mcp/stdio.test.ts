import assert from "node:assert/strict";
import { test } from "vitest";
import { parseStdioArgs } from "./stdio.js";

test("stdio serves both eras unless modern-only is requested", () => {
	assert.deepEqual(parseStdioArgs([]), { modernOnly: false });
	assert.deepEqual(parseStdioArgs(["--modern-only"]), { modernOnly: true });
	assert.throws(() => parseStdioArgs(["--legacy-only"]), /Unknown argument/);
});

import type { CanvasError } from "../types/messages.js";

const GOO_CONVERSION_ERROR_PATTERN = /Data conversion failed from Goo/i;

export function isGooConversionError(text: string): boolean {
	return GOO_CONVERSION_ERROR_PATTERN.test(text);
}

export function hasGooConversionError(errors: CanvasError[]): boolean {
	return errors.some((error) => isGooConversionError(error.text));
}

export function formatPythonTreeConversionHint(): string {
	return [
		"Likely cause: a Python script output a plain Python list instead of a Grasshopper DataTree.",
		"Tree-access outputs need ghpythonlib.treehelpers:",
		"",
		"  import ghpythonlib.treehelpers as th",
		"  nested = th.tree_to_list(x)          # tree input",
		"  a = th.list_to_tree(result)          # tree output",
		"",
		"Full recipes: mds/reference/python-boilerplate.md",
	].join("\n");
}

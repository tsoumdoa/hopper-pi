/** Count lines in text, treating a trailing newline as not adding an extra line. */
export function lineCount(text: string): number {
	if (!text) return 0;
	const lines = text.split("\n");
	if (lines.length > 1 && lines[lines.length - 1] === "") {
		return lines.length - 1;
	}
	return lines.length;
}

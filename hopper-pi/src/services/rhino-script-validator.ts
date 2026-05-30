const MAX_SOURCE_LENGTH = 64_000;

const COMMAND_DENYLIST: RegExp[] = [
	/(?<![A-Za-z])['_-]*Exit\b/i,
	/(?<![A-Za-z])['_-]*Quit\b/i,
	/(?<![A-Za-z])['_-]*Open\b/i,
	/(?<![A-Za-z])['_-]*SaveAs\b/i,
	/(?<![A-Za-z])['_-]*New\b/i,
	/(?<![A-Za-z])['_-]*Close\b/i,
];

export function validateRhinoScriptItem(item: {
	mode: string;
	source: string;
}): string | null {
	if (!item.source?.trim()) {
		return "source must not be empty";
	}

	if (item.source.length > MAX_SOURCE_LENGTH) {
		return `source exceeds maximum length (${MAX_SOURCE_LENGTH} characters)`;
	}

	if (item.mode === "command") {
		for (const pattern of COMMAND_DENYLIST) {
			if (pattern.test(item.source)) {
				return `command mode blocked pattern: ${pattern.source}`;
			}
		}
	}

	return null;
}

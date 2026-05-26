const numberToGuid = new Map<number, string>();

export function registerComponents(entries: Array<{ num: number; typeGuid: string }>): void {
	numberToGuid.clear();
	for (const { num, typeGuid } of entries) {
		numberToGuid.set(num, typeGuid);
	}
}

export function resolveComponentNumber(value: string): string | null {
	const numStr = value.replace(/^#/, "");
	const num = parseInt(numStr, 10);
	if (isNaN(num)) return null;
	return numberToGuid.get(num) ?? null;
}

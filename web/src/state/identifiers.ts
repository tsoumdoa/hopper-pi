export function identifier(prefix: string) {
	return `${prefix}-${crypto.randomUUID()}`;
}

import { randomId } from "../lib/random-id";
export function identifier(prefix: string) {
	return `${prefix}-${randomId()}`;
}

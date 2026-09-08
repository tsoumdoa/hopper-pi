/** Separates a confirmed native failure from missing execution evidence. */
export class NativeActionError extends Error {
	constructor(
		message: string,
		readonly outcome: "completed" | "failed" | "cancelled" | "uncertain",
		readonly evidence: unknown,
	) {
		super(message);
	}
}

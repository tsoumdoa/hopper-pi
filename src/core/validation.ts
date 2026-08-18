import { Value } from "@sinclair/typebox/value";
import type { TSchema } from "@sinclair/typebox";

export type ValidationResult =
	| { ok: true }
	| { ok: false; errors: Array<{ path: string; message: string }> };

export function validateSchema(schema: TSchema, value: unknown): ValidationResult {
	if (Value.Check(schema, value)) return { ok: true };
	return {
		ok: false,
		errors: [...Value.Errors(schema, value)].map((error) => ({
			path: error.path || "$",
			message: error.message,
		})),
	};
}

export function validationMessage(result: Exclude<ValidationResult, { ok: true }>): string {
	return result.errors
		.slice(0, 8)
		.map((error) => `${error.path}: ${error.message}`)
		.join("; ");
}

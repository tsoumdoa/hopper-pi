/** Small wire readers: reject invalid fields and copy only the declared contract. */
export type Reader<T> = (value: unknown) => T;
export type ReadValue<R> = R extends Reader<infer T> ? T : never;
export function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
	return value as Record<string, unknown>;
}
export const string: Reader<string> = value => {
	if (typeof value !== "string") throw new Error("Expected a string");
	return value;
};
export const number: Reader<number> = value => {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected a finite number");
	return value;
};
export const boolean: Reader<boolean> = value => {
	if (typeof value !== "boolean") throw new Error("Expected a boolean");
	return value;
};
export const unknown: Reader<unknown> = value => value;
export const optional = <T>(read: Reader<T>): Reader<T | undefined> => value => value === undefined ? undefined : read(value);
export const nullable = <T>(read: Reader<T>): Reader<T | null> => value => value === null ? null : read(value);
export const array = <T>(read: Reader<T>): Reader<T[]> => value => {
	if (!Array.isArray(value)) throw new Error("Expected an array");
	return value.map(read);
};
export const oneOf = <const T extends readonly (string | number)[]>(...values: T): Reader<T[number]> => value => {
	if (!values.some(item => item === value)) throw new Error("Invalid state or message kind");
	return value as T[number];
};
type Shape = Record<string, Reader<unknown>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: undefined extends ReadValue<S[K]> ? K : never }[keyof S];
type Fields<S extends Shape> = { [K in Exclude<keyof S, OptionalKeys<S>>]: ReadValue<S[K]> } & { [K in OptionalKeys<S>]?: ReadValue<S[K]> };
export function fields<S extends Shape>(shape: S): Reader<Fields<S>> {
	return value => {
		const source = object(value), result: Record<string, unknown> = {};
		for (const [key, read] of Object.entries(shape)) {
			try {
				const field = read(source[key]);
				if (field !== undefined) result[key] = field;
			} catch { throw new Error(`Invalid browser field: ${key}`); }
		}
		return result as Fields<S>;
	};
}
export const dictionary = <T>(read: Reader<T>): Reader<Record<string, T>> => value =>
	Object.fromEntries(Object.entries(object(value)).map(([key, item]) => [key, read(item)]));
export const jsonText: Reader<string> = value => {
	const text = string(value);
	JSON.parse(text);
	return text;
};
export function readJson<T>(value: unknown, read: Reader<T>, fallback: T): T {
	try { return read(JSON.parse(string(value))); } catch { return fallback; }
}

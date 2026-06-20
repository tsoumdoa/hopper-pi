export type Paginated<T> = {
	slice: T[];
	hasMore: boolean;
	total: number;
};

export function paginate<T>(
	items: T[],
	limit?: number,
	offset?: number,
	defaultLimit = 50,
	maxLimit = 100,
): Paginated<T> {
	const total = items.length;
	const effectiveLimit = Math.min(limit ?? defaultLimit, maxLimit);
	const effectiveOffset = Math.max(offset ?? 0, 0);
	const slice = items.slice(effectiveOffset, effectiveOffset + effectiveLimit);
	return {
		slice,
		hasMore: effectiveOffset + slice.length < total,
		total,
	};
}

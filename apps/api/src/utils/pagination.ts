import type { Context } from 'hono';

export interface PaginationParams {
	limit: number;
	offset: number;
}

export function parsePagination(
	c: Context,
	defaults: { limit?: number; maxLimit?: number } = {},
): PaginationParams {
	const { limit: defaultLimit = 25, maxLimit = 100 } = defaults;
	const limit = Math.min(
		Math.max(Number.parseInt(c.req.query('limit') || String(defaultLimit), 10), 1),
		maxLimit,
	);
	const offset = Math.max(Number.parseInt(c.req.query('offset') || '0', 10), 0);
	return { limit, offset };
}

/** Paginate an in-memory array (for filesystem/S3-based lists). */
export function paginateArray<T>(items: T[], params: PaginationParams): { data: T[]; total: number } {
	return {
		data: items.slice(params.offset, params.offset + params.limit),
		total: items.length,
	};
}

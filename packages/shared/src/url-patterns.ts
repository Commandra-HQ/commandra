/**
 * Smart URL pattern normalization — detects dynamic route segments and replaces
 * them with named placeholders. Used by both the extension indexer and the backend
 * sitemap builder to ensure consistent pattern matching.
 */

/**
 * Normalize a URL pathname into a route pattern by replacing dynamic segments.
 *
 * Examples:
 *   /invoices/123           → /invoices/:id
 *   /users/abc-def-1234...  → /users/:id       (UUID)
 *   /orders/ord_abc123      → /orders/:id       (prefixed ID)
 *   /reports/2026-03-27     → /reports/:date
 *   /commits/a1b2c3d4e5f6   → /commits/:id      (hex hash)
 */
export function normalizeUrlPattern(pathname: string): string {
	return pathname
		.split('/')
		.map((segment) => {
			if (!segment) return segment;

			// UUIDs: abc12345-def6-7890-abcd-ef1234567890
			if (
				/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(segment)
			)
				return ':id';

			// Numeric IDs: 123, 42
			if (/^\d+$/.test(segment)) return ':id';

			// Prefixed IDs: inv_abc123, usr_xyz, cus_12345
			if (/^[a-z]{2,5}_[a-zA-Z0-9]+$/.test(segment)) return ':id';

			// Short hashes: a1b2c3d4 (8+ hex chars, but not common words)
			if (/^[a-f0-9]{8,}$/i.test(segment)) return ':id';

			// NanoIDs / CUIDs: V1StGXR8_Z5jdHi6B-myT (20+ alphanum with mixed case)
			if (
				/^[a-zA-Z0-9_-]{20,}$/.test(segment) &&
				/[a-z]/.test(segment) &&
				/[A-Z]/.test(segment)
			)
				return ':id';

			// Date segments: 2026-03-27, 2026-03, standalone year 2020-2099
			if (/^\d{4}-\d{2}(-\d{2})?$/.test(segment)) return ':date';
			if (/^20[2-9]\d$/.test(segment)) return ':date';

			return segment;
		})
		.join('/');
}

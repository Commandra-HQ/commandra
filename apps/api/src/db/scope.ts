import { eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { AuthUser } from '../middleware/auth.js';

/**
 * Returns a WHERE clause that scopes data by org (if user is in an org) or by user ID.
 * Use this to ensure org members see shared data, while non-org users see only their own.
 */
export function getOrgOrUserScope(
	user: AuthUser,
	table: { orgId: PgColumn; userId: PgColumn },
): SQL {
	if (user.orgId) {
		return eq(table.orgId, user.orgId);
	}
	return eq(table.userId, user.id);
}

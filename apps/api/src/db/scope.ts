import { eq, or, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { AuthUser } from '../middleware/auth.js';

/**
 * Returns a WHERE clause that scopes data by org OR by user ID.
 * Users see both their personal data (orgId=null, userId=match) AND their org's shared data.
 * This handles the case where a user created data before joining an org.
 */
export function getOrgOrUserScope(
	user: AuthUser,
	table: { orgId: PgColumn; userId: PgColumn },
): SQL {
	if (user.orgId) {
		// User is in an org — show both org-scoped data AND their personal data
		return or(eq(table.orgId, user.orgId), eq(table.userId, user.id))!;
	}
	return eq(table.userId, user.id);
}

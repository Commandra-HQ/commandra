# 30A-2 — Commandra Sync Endpoint

> Single API endpoint that receives the full org member list and upserts everything into commandra's DB.

## What

`POST /api/orgs/sync` — called by the landing-page webhook handler (server-to-server). Not called by users directly.

## Auth

Uses a shared secret (`X-Sync-Secret` header), NOT a user JWT. This is server-to-server communication.

## Request Format

```typescript
// POST /api/orgs/sync
{
  externalOrgId: string,       // Clerk org ID ("org_xxxxx")
  orgName: string,
  members: [
    {
      externalUserId: string,  // Clerk user ID ("user_xxxxx")
      email: string,
      role: "admin" | "member"
    }
  ]
}

// DELETE /api/orgs/sync
{
  externalOrgId: string
}
```

## Sync Logic (POST)

```
1. Upsert organization by externalId
   - INSERT ... ON CONFLICT (external_id) DO UPDATE SET name = $orgName
   - Get back the org.id (Postgres UUID)

2. For each member:
   a. Upsert user by externalId
      - INSERT ... ON CONFLICT (external_id) DO UPDATE SET email = $email
      - Get back the user.id (Postgres UUID)
   b. Upsert org_members row
      - INSERT ... ON CONFLICT (org_id, user_id) DO UPDATE SET role = $role

3. Remove stale members
   - DELETE FROM org_members
     WHERE org_id = $orgId
     AND user_id NOT IN ($syncedUserIds)
   - This handles members removed in Clerk

4. Return { ok: true, synced: memberCount }
```

## Delete Logic (DELETE)

```
1. Find org by externalId
2. Delete all org_members for that org
3. Nullify orgId on related tables (sites, conversations, agents, audit_logs)
4. Delete the organization row
5. Return { ok: true }
```

## Implementation

### New file: `apps/api/src/routes/sync.ts`

```typescript
import { and, eq, notInArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { orgMembers, organizations, users } from '../db/schema.js';

export const syncRoutes = new Hono();

// Auth: shared secret (server-to-server)
syncRoutes.use('*', async (c, next) => {
  const secret = c.req.header('X-Sync-Secret');
  if (!secret || secret !== process.env.SYNC_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

// Full org member sync
syncRoutes.post('/', async (c) => {
  const { externalOrgId, orgName, members } = await c.req.json();

  if (!externalOrgId || !orgName || !Array.isArray(members)) {
    return c.json({ error: 'externalOrgId, orgName, members required' }, 400);
  }

  // 1. Upsert org
  const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const [org] = await db
    .insert(organizations)
    .values({ externalId: externalOrgId, name: orgName, slug })
    .onConflictDoUpdate({ target: organizations.externalId, set: { name: orgName } })
    .returning();

  // 2. Upsert each member
  const syncedUserIds: string[] = [];
  for (const m of members) {
    const [user] = await db
      .insert(users)
      .values({ externalId: m.externalUserId, email: m.email })
      .onConflictDoUpdate({ target: users.externalId, set: { email: m.email } })
      .returning();

    syncedUserIds.push(user.id);

    await db
      .insert(orgMembers)
      .values({ orgId: org.id, userId: user.id, role: m.role })
      .onConflictDoUpdate({
        target: [orgMembers.orgId, orgMembers.userId], // requires unique constraint
        set: { role: m.role },
      });
  }

  // 3. Remove members not in sync list
  if (syncedUserIds.length > 0) {
    await db
      .delete(orgMembers)
      .where(
        and(
          eq(orgMembers.orgId, org.id),
          notInArray(orgMembers.userId, syncedUserIds)
        )
      );
  }

  return c.json({ ok: true, synced: members.length });
});

// Delete org
syncRoutes.delete('/', async (c) => {
  const { externalOrgId } = await c.req.json();

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.externalId, externalOrgId))
    .limit(1);

  if (!org) return c.json({ error: 'Org not found' }, 404);

  // Remove all memberships
  await db.delete(orgMembers).where(eq(orgMembers.orgId, org.id));
  // Delete org
  await db.delete(organizations).where(eq(organizations.id, org.id));

  return c.json({ ok: true });
});
```

### Mount in main app

```typescript
// apps/api/src/index.ts (or wherever routes are mounted)
import { syncRoutes } from './routes/sync.js';
app.route('/api/orgs/sync', syncRoutes);
```

### New env var (commandra API)

| Variable | Description |
|----------|-------------|
| `SYNC_SECRET` | Shared secret, must match `COMMANDRA_SYNC_SECRET` in landing-page |

### DB Prerequisite

Requires the unique constraint on `org_members(org_id, user_id)` from step 30A-3 (or add it here).

## Edge Cases

- **Member has no commandra account yet**: sync creates a user row with just `externalId` + `email` (no `passwordHash`). When they log in via Clerk → token exchange, it upserts the same row.
- **Webhook arrives before first login**: works fine — user row exists, org membership exists. Token exchange just updates email if needed.
- **Multiple webhooks at once**: each sync is idempotent. Concurrent syncs may briefly race but the final state is always correct.
- **Org has >100 members**: Clerk API paginates. Should loop through pages in the webhook handler. For v1, 100 limit is fine (most orgs are smaller).

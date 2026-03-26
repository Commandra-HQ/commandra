# 30A-3 — Admin/Member Roles

> Two roles: `admin` and `member`. Everyone can do everything (agents, conversations, knowledge, etc.), except only admins can manage org membership.

## Role Model

| Role | Can do everything (agents, chat, knowledge, sites, audit) | Can invite members | Can remove members | Can change roles |
|------|----------------------------------------------------------|--------------------|--------------------|-----------------|
| `admin` | Yes | Yes | Yes | Yes |
| `member` | Yes | No | No | No |

This is intentionally simple. No `viewer`, no `owner`, no granular permissions. Just: can you manage the team or not?

## What Changes

### 1. Unique Constraint on org_members

**Drizzle migration**: add unique constraint on `(org_id, user_id)`. Required for upsert in sync endpoint.

```typescript
// In schema.ts — add unique index
import { uniqueIndex } from 'drizzle-orm/pg-core';

// Add to orgMembers table or as a separate index
export const orgMembersOrgUserIdx = uniqueIndex('org_members_org_user_idx')
  .on(orgMembers.orgId, orgMembers.userId);
```

### 2. Role Check on Org Member Routes

Already exists in `apps/api/src/routes/orgs.ts` — the invite/remove/change-role routes check `membership.role !== 'admin'`. No change needed here except:

- Update the role validation in `PUT /:id/members/:userId` to only allow `admin` and `member` (remove `viewer` for now):

```typescript
// Before
if (!role || !['admin', 'member', 'viewer'].includes(role)) {
// After
if (!role || !['admin', 'member'].includes(role)) {
```

### 3. Clerk Role Mapping

Already done in the landing-page token route (`src/app/api/token/route.ts`):

```typescript
body.role = orgRole === "org:admin" ? "admin" : "member";
```

And in the webhook handler (30A-1):

```typescript
role: m.role === 'org:admin' ? 'admin' : 'member',
```

Clerk's `org:admin` → our `admin`. Everything else → `member`.

### 4. Token Exchange Role Handling

Already done in `apps/api/src/routes/token.ts`:

```typescript
const memberRole = role || 'member';
```

If no role provided, defaults to `member`. No change needed.

### 5. Dashboard Role Display

In `apps/web/app/(dashboard)/org/page.tsx`, the role dropdown already shows roles. Update to only show `admin` and `member`:

```tsx
<Select ...>
  <option value="admin">Admin</option>
  <option value="member">Member</option>
  {/* Remove viewer option */}
</Select>
```

## Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/db/schema.ts` | Add unique index on `org_members(org_id, user_id)` |
| Drizzle migration | Create the unique constraint |
| `apps/api/src/routes/orgs.ts` | Update role validation to `['admin', 'member']` |
| `apps/web/app/(dashboard)/org/page.tsx` | Remove `viewer` from role dropdown |

## What We're NOT Doing Yet

- **`viewer` role** — adds complexity, no one needs it yet
- **`owner` role** — useful for self-hosted, not needed for Clerk (Clerk manages ownership)
- **Per-route permission checks** — everyone can do everything except manage members. No `requirePermission` middleware yet.
- **Granular permissions** — no `agents:create` vs `agents:delete` distinction. All-or-nothing access.

These are all Phase 30B+ concerns. Keep it simple for now.

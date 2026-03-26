# Phase 30 — Enterprise Auth, Orgs & SSO

> Make org management actually work end-to-end (Clerk cloud + self-hosted), then layer on SSO and RBAC for enterprise on-prem deployments.

## Why

Commandra has the foundation — JWT auth, token exchange bridge, org/member tables, dashboard org page — but several gaps prevent orgs from working in practice:

1. **Invite is broken** — dashboard invite requires the user to already exist in the DB. If they haven't signed up yet, it returns 404. Real invites need to create a placeholder or send an email.
2. **Clerk sync is one-way** — Clerk org members get synced to commandra on login (via token exchange), but inviting from the dashboard doesn't sync back to Clerk. Members invited from different systems are invisible to each other.
3. **No org creation from dashboard** — self-hosted users see "You are not part of an organization" with no way to create one.
4. **No org context in UI** — no org name shown, no way to see which org you're in.
5. **No permission enforcement** — `viewer` role exists but can do everything a `member` can. No route-level checks.
6. **No SSO** — enterprises need Okta/Azure AD/Google Workspace login, not email/password forms.

## Current State

### What Works

- Token exchange: Clerk → `POST /api/token/exchange` → upserts user + org + membership → JWT
- Org CRUD API: create org, list members, invite (existing users only), change role, remove
- Dashboard org page: member list, invite form (admin only), role dropdown, remove button
- TanStack Query hooks: `useOrgMembersQuery`, `useInviteMemberMutation`, etc.
- Auth context: exposes `orgId`, `orgName`, `role` to all dashboard components
- Sidebar: shows "Organization" link only when user has `orgId`

### What's Broken

- Invite only works for existing users (404 if email not in DB)
- No pending invite concept (no way to invite someone who hasn't signed up)
- Self-hosted users can't create orgs from dashboard
- Org page doesn't show org name
- No permission checks on any route except member management
- `owner` role doesn't exist (creator is just `admin`, same as promoted members)

---

## Phase 30A — Clerk Org Sync (Cloud First)

> Make Clerk orgs + members fully visible in the dashboard. Clerk is the source of truth for cloud — sync it properly before building self-hosted org management.

### The Problem

Today, commandra only learns about Clerk org members **one-by-one when each person logs in** (via token exchange). If an admin invites 5 people to a Clerk org, the dashboard shows 0 members until each one individually signs in. There's no proactive sync.

### The Solution: Clerk Webhooks

Clerk fires webhooks on org/member lifecycle events. The landing page receives them and calls commandra's API to sync. Members appear in the dashboard immediately.

```
Clerk Dashboard                    Landing Page                     Commandra API
     │                                  │                                │
     │  Admin invites user@acme.com     │                                │
     │ ─────────────────────────────►   │                                │
     │  Webhook: organizationMembership │                                │
     │            .created              │                                │
     │ ─────────────────────────────►   │  POST /api/orgs/sync           │
     │                                  │ ──────────────────────────────► │
     │                                  │  { externalOrgId, members[] }  │
     │                                  │                                │ Upsert org + all members
     │                                  │                                │
     │                                  │  ◄──────────────────────────── │
     │                                  │  { ok: true }                  │
```

### 30A-1. Clerk Webhook Handler (landing-page repo)

**New file**: `landing-page/src/app/api/webhooks/clerk/route.ts`

**New dependency**: `svix` (Clerk uses Svix for webhook signing/verification)

Clerk webhook events to handle:

| Event | Action |
|-------|--------|
| `organization.created` | Call commandra sync (creates org) |
| `organization.updated` | Call commandra sync (updates org name) |
| `organization.deleted` | Call commandra to delete org |
| `organizationMembership.created` | Call commandra sync (adds member) |
| `organizationMembership.updated` | Call commandra sync (updates role) |
| `organizationMembership.deleted` | Call commandra sync (removes member) |

**Webhook handler logic**:

```typescript
// landing-page/src/app/api/webhooks/clerk/route.ts
// 1. Verify webhook signature using Svix
// 2. Parse event type
// 3. For membership events: fetch full org member list from Clerk
// 4. Call commandra POST /api/orgs/sync with full member list
// 5. For org deletion: call commandra DELETE /api/orgs/by-external/:externalId
```

**Why full member list sync (not incremental)?** Simpler, idempotent, self-healing. If a webhook is missed, the next one re-syncs everything. No state tracking needed.

**New env var** in landing-page:
- `CLERK_WEBHOOK_SECRET` — from Clerk dashboard webhook config
- `COMMANDRA_SYNC_SECRET` — shared secret for authenticating sync calls to commandra API

### 30A-2. Commandra Sync Endpoint

**New route in commandra API**: `POST /api/orgs/sync`

This is the single endpoint the landing page calls to sync Clerk org state into commandra's DB.

```typescript
// POST /api/orgs/sync
// Auth: COMMANDRA_SYNC_SECRET header (server-to-server, not user JWT)
// Body:
{
  externalOrgId: string,       // Clerk org ID (e.g., "org_xxxxx")
  orgName: string,             // Clerk org name
  members: [
    {
      externalUserId: string,  // Clerk user ID (e.g., "user_xxxxx")
      email: string,
      role: string,            // "org:admin" | "org:member" — mapped to "admin" | "member"
    }
  ]
}
```

**Sync logic**:

```
1. Upsert organization by externalId (create if new, update name if changed)
2. For each member in the list:
   a. Upsert user by externalId (create placeholder if they haven't logged in yet)
   b. Upsert org_members row (add or update role)
3. Remove org_members rows for users NOT in the incoming list
   (handles members removed in Clerk)
4. Return { ok: true, synced: memberCount }
```

**Key detail**: Users created via sync may not have a `passwordHash` (they haven't registered via self-hosted flow). That's fine — they'll complete their profile on first login via token exchange. The user row exists so the dashboard can show them as members immediately.

**New env var** in commandra API:
- `SYNC_SECRET` — must match `COMMANDRA_SYNC_SECRET` in landing page

### 30A-3. Org Page Sync Indicator

**Dashboard changes** (modify `apps/web/app/(dashboard)/org/page.tsx`):

For cloud users (user has `externalId` / came through Clerk):
- Show members list as read-only (Clerk is source of truth for membership)
- Show message: "Members are managed through your organization settings" with link to Clerk org management
- Show "Last synced" timestamp
- Admin actions (invite, remove, role change) are disabled — these happen in Clerk, not the dashboard

For self-hosted users (no `externalId`):
- Show existing invite/manage UI (will be enhanced in Phase 30A-self-hosted)

**How to detect cloud vs self-hosted**: Check if the org has an `externalId`. If yes → cloud (Clerk-managed). If no → self-hosted (dashboard-managed).

### 30A-4. Org Context in UI

- Org page header: show org name and member count
- Sidebar: show org name under "Organization" link
- Topbar: show org name in page description

### 30A-5. Unique Constraint on Org Members

Add unique constraint on `(orgId, userId)` via Drizzle migration. Required for upsert logic in sync endpoint.

### Files to Create/Modify

**Landing page (separate repo)**:
- `src/app/api/webhooks/clerk/route.ts` — NEW: webhook handler
- `package.json` — add `svix` dependency

**Commandra API**:
- `apps/api/src/routes/sync.ts` — NEW: sync endpoint
- `apps/api/src/db/schema.ts` — add unique constraint on org_members
- Drizzle migration

**Dashboard**:
- `apps/web/app/(dashboard)/org/page.tsx` — cloud vs self-hosted mode, org name header
- `apps/web/components/sidebar.tsx` — show org name

---

## Phase 30A-SH — Self-Hosted Org Management

> After cloud orgs work via Clerk sync, add self-hosted org management (invites, creation, owner role). These features are only used when there's no Clerk/SSO — the dashboard IS the org management tool.

### 30A-SH-1. Pending Invites

**Problem**: `POST /api/orgs/:id/members` fails with 404 if the invited email doesn't exist in the DB yet.

**Solution**: Add an `org_invites` table for pending invites. When the invited user signs up or logs in (via any auth path), check for pending invites and auto-add them to the org.

```typescript
export const orgInvites = pgTable('org_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .references(() => organizations.id)
    .notNull(),
  email: text('email').notNull(),
  role: text('role').notNull().default('member'),
  invitedBy: uuid('invited_by')
    .references(() => users.id)
    .notNull(),
  status: text('status').notNull().default('pending'), // 'pending' | 'accepted' | 'expired'
  expiresAt: timestamp('expires_at').notNull(), // 7 days from creation
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

**Changes**:

- `POST /api/orgs/:id/members`: if user exists in DB → add directly. If not → create invite row.
- `POST /api/auth/register` and `POST /api/token/exchange`: after user upsert, check `org_invites` for matching email. If found, auto-add to org + mark invite as accepted.
- `GET /api/orgs/:id/members`: return both active members AND pending invites (with a `status: 'pending'` flag).
- `DELETE /api/orgs/:id/invites/:inviteId`: cancel a pending invite (admin only).

**Dashboard changes**:

- Invite form: works the same, but now succeeds for any email
- Member list: show pending invites with a "Pending" badge and a cancel button
- Only shown for self-hosted orgs (no `externalId` on org)

### 30A-SH-2. Org Creation from Dashboard

**Problem**: Self-hosted users have no way to create an org.

**Solution**: Add a create org UI when user has no `orgId`.

- When `!user.orgId`: show a "Create Organization" card with a name input + create button
- On create: `POST /api/orgs` → creator becomes owner → refresh JWT → page reloads with org context

**New API route**:

- `POST /api/auth/refresh`: requires valid JWT, looks up current org membership, issues new JWT with `orgId` + `role`. Dashboard calls this after org create/join.

### 30A-SH-3. Owner Role

- New role value: `owner` (stored in `org_members.role`, no schema change)
- `POST /api/orgs` (create org): set creator's role to `owner` instead of `admin`
- `PUT /api/orgs/:id/members/:userId`: prevent changing owner's role
- `DELETE /api/orgs/:id/members/:userId`: prevent removing owner
- Dashboard: show `owner` as read-only badge

### Files to Create/Modify

**New files**:

- Drizzle migration for `org_invites` table

**Modified files**:

- `apps/api/src/db/schema.ts` — add `orgInvites` table
- `apps/api/src/routes/orgs.ts` — pending invite logic, owner protection
- `apps/api/src/routes/auth.ts` — add `POST /api/auth/refresh`, check pending invites on register
- `apps/api/src/routes/token.ts` — check pending invites on token exchange, owner role for new orgs
- `apps/web/app/(dashboard)/org/page.tsx` — create org UI, pending invites display
- `apps/web/lib/queries/use-org.ts` — add invite cancel mutation, refresh token after org create
- `apps/web/lib/auth-context.tsx` — add `refreshToken()` method

---

## Phase 30B — Permissions System

> Add route-level permission checks so roles actually mean something. No new dependencies.

### 30B-1. Permission Definitions

**New file**: `apps/api/src/auth/permissions.ts`

```typescript
type Permission =
  | 'agents:view'
  | 'agents:create'
  | 'agents:edit'
  | 'agents:delete'
  | 'agents:execute'
  | 'conversations:view'
  | 'conversations:create'
  | 'conversations:delete'
  | 'org:settings'
  | 'org:members:invite'
  | 'org:members:remove'
  | 'org:members:change-role'
  | 'audit:view'
  | 'audit:export'
  | 'sites:manage'
  | 'knowledge:edit';

const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  owner: [
    /* all */
  ],
  admin: [
    /* all except owner-only actions (none yet) */
  ],
  member: [
    'agents:view',
    'agents:create',
    'agents:edit',
    'agents:execute',
    'conversations:view',
    'conversations:create',
    'audit:view',
    'sites:manage',
    'knowledge:edit',
  ],
  viewer: ['agents:view', 'conversations:view', 'audit:view'],
};
```

### 30B-2. Middleware

```typescript
function requirePermission(...perms: Permission[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    const userPerms = ROLE_PERMISSIONS[user.role || 'member'] || [];
    for (const perm of perms) {
      if (!userPerms.includes(perm)) return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
  };
}
```

### 30B-3. Apply to Routes

| Route                               | Permission                |
| ----------------------------------- | ------------------------- |
| `POST /api/chat`                    | `agents:execute`          |
| `POST /api/agents`                  | `agents:create`           |
| `PUT /api/agents/:id`               | `agents:edit`             |
| `DELETE /api/agents/:id`            | `agents:delete`           |
| `DELETE /api/conversations/:id`     | `conversations:delete`    |
| `POST /api/orgs/:id/members`        | `org:members:invite`      |
| `PUT /api/orgs/:id/members/:uid`    | `org:members:change-role` |
| `DELETE /api/orgs/:id/members/:uid` | `org:members:remove`      |

### 30B-4. Dashboard Permission Awareness

- Hide action buttons when user lacks permission (use `role` from auth context)
- Show 403 error gracefully if backend rejects
- Viewer sees agents/conversations read-only (no execute button, no edit)

### Files to Create/Modify

**New files**:

- `apps/api/src/auth/permissions.ts`

**Modified files**:

- `apps/api/src/routes/agents.ts` — add `requirePermission` to CRUD routes
- `apps/api/src/routes/orgs.ts` — replace inline admin checks with `requirePermission`
- `apps/api/src/routes/chat.ts` — add `requirePermission('agents:execute')`
- `apps/web/app/(dashboard)/agents/page.tsx` — hide create/edit/delete for viewers
- `apps/web/app/(dashboard)/org/page.tsx` — already handles admin-only UI, just refine

---

## Phase 30C — OIDC SSO

> Enterprise login via Okta, Azure AD, Google Workspace, Keycloak. First SSO protocol.

### 30C-1. SSO Connections Table

```typescript
export const ssoConnections = pgTable('sso_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .references(() => organizations.id)
    .notNull(),
  protocol: text('protocol').notNull(), // 'oidc' | 'saml'

  // OIDC
  issuerUrl: text('issuer_url'),
  clientId: text('client_id'),
  clientSecretEncrypted: text('client_secret_encrypted'),

  // SAML (Phase 30D)
  idpEntityId: text('idp_entity_id'),
  idpSsoUrl: text('idp_sso_url'),
  idpCertificate: text('idp_certificate'),
  spEntityId: text('sp_entity_id'),

  // Shared
  emailDomains: jsonb('email_domains').$type<string[]>().default([]),
  groupRoleMap: jsonb('group_role_map')
    .$type<Record<string, string>>()
    .default({}),
  defaultRole: text('default_role').notNull().default('member'),
  autoProvision: boolean('auto_provision').notNull().default(true),
  enforced: boolean('enforced').notNull().default(false),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### 30C-2. OIDC Routes

| Method | Route                    | Auth | Description                                                            |
| ------ | ------------------------ | ---- | ---------------------------------------------------------------------- |
| `GET`  | `/api/sso/authorize`     | none | Look up SSO connection by email domain, redirect to IdP                |
| `GET`  | `/api/sso/oidc/callback` | none | Validate tokens, extract claims, token exchange, redirect to dashboard |
| `GET`  | `/api/sso/check`         | none | Check if email domain has SSO configured                               |

**Callback flow**:

1. Extract `code` and `state` from query params
2. Look up SSO connection from `state`
3. Exchange code for tokens via `openid-client`
4. Extract email + groups from claims
5. Map groups → role using `groupRoleMap`
6. Run token exchange logic (upsert user + org membership + issue JWT)
7. Redirect to `DASHBOARD_URL/auth/callback?token=<jwt>`

### 30C-3. Admin CRUD API

| Method   | Route                  | Auth      | Description                       |
| -------- | ---------------------- | --------- | --------------------------------- |
| `GET`    | `/api/orgs/:orgId/sso` | org admin | Get SSO config (secrets redacted) |
| `POST`   | `/api/orgs/:orgId/sso` | org admin | Create/update SSO connection      |
| `DELETE` | `/api/orgs/:orgId/sso` | org admin | Remove SSO connection             |

### 30C-4. Login Page SSO Detection

- User enters email on login page
- On blur, call `GET /api/sso/check?email=user@acme.com`
- If SSO found + enforced: hide password, show "Sign in with SSO"
- If SSO found + not enforced: show both options
- If no SSO: normal email/password form

### 30C-5. SSO Enforcement

When `enforced = true`:

- `POST /api/auth/login`: reject with `{ error: "SSO required" }` if user's org has enforced SSO
- `POST /api/auth/register`: reject if email domain matches enforced SSO connection

### New Dependencies

| Package         | Purpose                                       |
| --------------- | --------------------------------------------- |
| `openid-client` | OIDC discovery, code exchange, JWT validation |

### New Environment Variables

| Variable             | Required    | Description                                     |
| -------------------- | ----------- | ----------------------------------------------- |
| `SSO_ENCRYPTION_KEY` | If SSO used | 32-byte hex key for encrypting client secrets   |
| `APP_URL`            | If SSO used | Public URL of commandra API (for callback URLs) |

---

## Phase 30D — SAML SSO

> Add SAML 2.0 for legacy enterprise IdPs (Azure AD SAML, Okta SAML, ADFS).

### 30D-1. SAML Routes

| Method | Route                    | Auth | Description                                 |
| ------ | ------------------------ | ---- | ------------------------------------------- |
| `POST` | `/api/sso/saml/callback` | none | ACS endpoint — IdP posts SAML response here |
| `GET`  | `/api/sso/saml/metadata` | none | SP metadata XML for IdP admin               |

### 30D-2. SAML Callback Flow

1. Parse SAML response from POST body
2. Look up SSO connection by issuer
3. Verify XML signature against stored IdP certificate
4. Extract email + groups from assertion
5. Map groups → role, run token exchange, redirect to dashboard

### 30D-3. Dashboard SSO Admin UI

**New page**: `apps/web/app/(dashboard)/settings/sso/page.tsx`

- Protocol toggle (OIDC / SAML)
- OIDC: issuer URL, client ID, client secret
- SAML: IdP metadata XML upload or manual entry
- Email domains config
- Group → role mapping
- Auto-provision toggle
- Enforcement toggle (with warning)
- Test button
- SP metadata download (SAML)

### New Dependencies

| Package                | Purpose                                           |
| ---------------------- | ------------------------------------------------- |
| `@node-saml/node-saml` | SAML response parsing, XML signature verification |

---

## Phase 30E — Enterprise Polish (Future)

> Nice-to-haves for large enterprise deployments. Build when customers ask.

- **SCIM provisioning** — auto-sync user directory from IdP (create/deactivate users automatically)
- **Session management UI** — list active sessions, revoke tokens
- **Audit log for auth events** — login, SSO, role change, invite, remove
- **Custom roles** — admin-defined permission sets per org
- **Org switcher** — for users in multiple orgs

---

## Compatibility with Clerk (Cloud)

After Phase 30A, the cloud flow becomes:

```
Auth (unchanged):  Clerk → landing-page /api/token → POST /api/token/exchange → JWT
Org sync (new):    Clerk webhooks → landing-page /api/webhooks/clerk → POST /api/orgs/sync
```

**Two separate channels**:
- **Auth channel** (token exchange): handles individual user login, JWT issuance. Unchanged.
- **Sync channel** (webhooks): keeps org membership in sync. New in 30A.

Both channels converge on the same `organizations` and `org_members` tables. Clerk orgs use `externalId` = Clerk org ID. SSO orgs (Phase 30C) will use `externalId` = IdP tenant ID. Self-hosted orgs have no `externalId`.

**Dashboard behavior by mode**:
- **Cloud** (org has `externalId`): member list is read-only, managed via Clerk. Synced by webhooks.
- **Self-hosted** (org has no `externalId`): member list is editable, managed via dashboard. Invites via `org_invites` table.
- **Enterprise SSO** (Phase 30C): member list managed via IdP + auto-provisioning on login.

Pending invites (30A-SH) work across self-hosted and SSO auth paths — the invite check happens on user upsert in `POST /api/auth/register` and `POST /api/token/exchange`.

## Implementation Order

| Phase       | What                                             | Dependencies | Effort | Priority      |
| ----------- | ------------------------------------------------ | ------------ | ------ | ------------- |
| **30A**     | Clerk webhook sync + org context UI              | None         | Medium | **Now**       |
| **30A-SH**  | Self-hosted org management (invites, creation, owner) | 30A    | Medium | **Now**       |
| **30B**     | Permissions system                               | None         | Small  | **Now**       |
| **30C**     | OIDC SSO                                         | 30A-SH, 30B  | Medium | Next          |
| **30D**     | SAML SSO + admin UI                              | 30C          | Medium | After         |
| **30E**     | Enterprise polish (SCIM, sessions, custom roles) | 30C/D        | Large  | Future        |

**Start with 30A (Clerk sync)** — this is the critical path. Cloud users need to see their org members in the dashboard. Then 30A-SH (self-hosted) and 30B (permissions) can be done in parallel. 30C (OIDC) comes when an enterprise customer needs it.

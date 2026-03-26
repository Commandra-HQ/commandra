# 30A-4 — Dashboard Org UI

> Show org name, member list, and admin controls in the dashboard. For cloud (Clerk) orgs, membership is read-only — managed via Clerk.

## What Changes

### 1. Org Page Header

Show org name and member count at the top of the org page.

```tsx
// apps/web/app/(dashboard)/org/page.tsx
<div className="space-y-1">
  <h2 className="text-lg font-medium">{user.orgName}</h2>
  <p className="text-sm text-muted-foreground">
    {members.length} member{members.length !== 1 ? 's' : ''}
  </p>
</div>
```

### 2. Cloud vs Self-Hosted Detection

Check if the org has an `externalId` to determine if it's Clerk-managed.

**Option A (simple)**: If the user came through Clerk (has `externalId` on their user row), treat the org as Clerk-managed. We can infer this from the auth flow — if the user logged in via token exchange (not email/password), they're a cloud user.

**Option B (explicit)**: Add `externalId` to the `/api/auth/me` response so the dashboard knows. Then check `user.orgExternalId` to determine mode.

**Go with Option B** — explicit is better. Modify `/api/auth/me` to include `orgExternalId` when the org has one.

### 3. Member Management (Cloud Mode)

When org has `externalId` (Clerk-managed):

- **Member list**: show all members with email + role badge (same as today)
- **Invite form**: show for admins, but route through Clerk
  - Option 1: Link to Clerk org settings ("Manage members in your organization settings")
  - Option 2: Call Clerk API from landing-page to invite (more seamless but more complex)
  - **Go with Option 1 for now** — simple, no extra API work
- **Role change**: disabled (show tooltip: "Manage roles in your organization settings")
- **Remove member**: disabled (same tooltip)

### 4. Member Management (Self-Hosted Mode)

When org has no `externalId`:

- Keep existing UI (invite form, role dropdown, remove button)
- This is Phase 30A-SH territory but the UI already exists and works for existing users

### 5. Sidebar Org Name

Show org name in the sidebar when the Organization nav item is present.

```tsx
// apps/web/components/sidebar.tsx
// When expanded, show org name as a small label under "Organization"
{user?.orgId && (
  <NavItem
    icon={Building2}
    label="Organization"
    sublabel={user.orgName} // <-- add this
    href="/org"
  />
)}
```

When collapsed, show org name as tooltip on hover.

### 6. Auth Context Update

Add `orgExternalId` to the auth context so components can check cloud vs self-hosted.

**`GET /api/auth/me` response change**:

```typescript
// apps/api/src/routes/auth.ts — /me endpoint
if (payload.orgId) {
  result.orgId = payload.orgId;
  result.role = payload.role;

  const [org] = await db
    .select({ name: organizations.name, externalId: organizations.externalId })
    .from(organizations)
    .where(eq(organizations.id, payload.orgId as string))
    .limit(1);
  if (org) {
    result.orgName = org.name;
    result.isClerkManaged = !!org.externalId; // <-- add this
  }
}
```

**Auth context type update**:

```typescript
// apps/web/lib/auth-context.tsx
interface User {
  id: string;
  email: string;
  orgId?: string;
  orgName?: string;
  role?: string;
  isClerkManaged?: boolean; // <-- add this
}
```

## Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/routes/auth.ts` | Add `isClerkManaged` to `/me` response |
| `apps/web/lib/auth-context.tsx` | Add `isClerkManaged` to User type |
| `apps/web/app/(dashboard)/org/page.tsx` | Org name header, cloud/self-hosted conditional UI |
| `apps/web/components/sidebar.tsx` | Show org name under Organization link |

## Mockup

### Cloud org (Clerk-managed)

```
┌──────────────────────────────────────────┐
│ Acme Corp                                │
│ 5 members · Managed by your org provider │
├──────────────────────────────────────────┤
│                                          │
│  alice@acme.com              admin       │
│  bob@acme.com                member      │
│  carol@acme.com              member      │
│  dave@acme.com               member      │
│  eve@acme.com                member      │
│                                          │
│  ┌─────────────────────────────────┐     │
│  │ Manage members in your          │     │
│  │ organization settings →         │     │
│  └─────────────────────────────────┘     │
└──────────────────────────────────────────┘
```

### Self-hosted org (dashboard-managed)

```
┌──────────────────────────────────────────┐
│ My Team                                  │
│ 3 members                               │
├──────────────────────────────────────────┤
│ ┌─ Invite Member ─────────────────────┐  │
│ │ Email: [________________] Role: [▼] │  │
│ │                            [Invite] │  │
│ └─────────────────────────────────────┘  │
│                                          │
│  alice@co.com    admin   [▼ role] [🗑]   │
│  bob@co.com      member  [▼ role] [🗑]   │
│  carol@co.com    member  [▼ role] [🗑]   │
└──────────────────────────────────────────┘
```

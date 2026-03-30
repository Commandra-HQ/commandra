# 30A-1 — Clerk Webhook Handler

> Landing-page receives Clerk org/member webhooks and forwards them to commandra's sync endpoint.

## What

When someone is invited to or removed from a Clerk org, Clerk fires a webhook. The landing-page receives it, fetches the full org member list from Clerk, and pushes it to commandra.

## Flow

```
Clerk org event (member added/removed/role changed)
  → POST landing-page/api/webhooks/clerk
  → Verify signature (svix)
  → Fetch all org members from Clerk API
  → POST commandra/api/orgs/sync with full member list
```

## Why Full Sync (Not Incremental)

Each webhook triggers a re-sync of ALL members for that org. This is:
- **Idempotent** — calling it twice produces the same result
- **Self-healing** — if a webhook is missed, the next one fixes everything
- **Simple** — no state tracking, no event ordering issues

## Webhook Events to Handle

| Event | Action |
|-------|--------|
| `organization.created` | Sync org (creates it in commandra) |
| `organization.updated` | Sync org (updates name) |
| `organization.deleted` | Delete org in commandra |
| `organizationMembership.created` | Full member sync |
| `organizationMembership.updated` | Full member sync (role change) |
| `organizationMembership.deleted` | Full member sync (removal) |

## Implementation

### New file: `landing-page/src/app/api/webhooks/clerk/route.ts`

```typescript
import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { clerkClient } from '@clerk/nextjs/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const SYNC_SECRET = process.env.COMMANDRA_SYNC_SECRET;
const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

export async function POST(req: Request) {
  // 1. Verify webhook signature
  const wh = new Webhook(WEBHOOK_SECRET!);
  const headerPayload = await headers();
  const svixHeaders = {
    'svix-id': headerPayload.get('svix-id')!,
    'svix-timestamp': headerPayload.get('svix-timestamp')!,
    'svix-signature': headerPayload.get('svix-signature')!,
  };
  const body = await req.text();
  const evt = wh.verify(body, svixHeaders) as WebhookEvent;

  // 2. Handle event
  const { type, data } = evt;

  if (type === 'organization.deleted') {
    await fetch(`${API_URL}/api/orgs/sync`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Secret': SYNC_SECRET!,
      },
      body: JSON.stringify({ externalOrgId: data.id }),
    });
    return new Response('ok');
  }

  // For all org/membership events, do a full sync
  const orgId = type.startsWith('organization.')
    ? data.id
    : data.organization?.id || data.organization_id;

  if (!orgId) return new Response('no org id', { status: 400 });

  // 3. Fetch full org + member list from Clerk
  const client = await clerkClient();
  const org = await client.organizations.getOrganization({ organizationId: orgId });
  const memberList = await client.organizations.getOrganizationMembershipList({
    organizationId: orgId,
    limit: 100,
  });

  // 4. Build member array
  const members = await Promise.all(
    memberList.data.map(async (m) => {
      // Get user email
      const user = await client.users.getUser(m.publicUserData!.userId!);
      const email = user.emailAddresses.find(
        (e) => e.id === user.primaryEmailAddressId
      )?.emailAddress || user.emailAddresses[0]?.emailAddress;

      return {
        externalUserId: m.publicUserData!.userId!,
        email: email!,
        role: m.role === 'org:admin' ? 'admin' : 'member',
      };
    })
  );

  // 5. Push to commandra
  await fetch(`${API_URL}/api/orgs/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Secret': SYNC_SECRET!,
    },
    body: JSON.stringify({
      externalOrgId: orgId,
      orgName: org.name,
      members,
    }),
  });

  return new Response('ok');
}
```

### New dependency

```bash
cd landing-page && pnpm add svix
```

### New env vars (landing-page)

| Variable | Description |
|----------|-------------|
| `CLERK_WEBHOOK_SECRET` | From Clerk dashboard → Webhooks → Signing Secret |
| `COMMANDRA_SYNC_SECRET` | Shared secret for authenticating sync calls to commandra API |

### Clerk Dashboard Setup

1. Go to Clerk Dashboard → Webhooks → Add Endpoint
2. URL: `https://your-landing-page.com/api/webhooks/clerk`
3. Subscribe to: `organization.created`, `organization.updated`, `organization.deleted`, `organizationMembership.created`, `organizationMembership.updated`, `organizationMembership.deleted`
4. Copy the Signing Secret → set as `CLERK_WEBHOOK_SECRET`

### Middleware Update

Add `/api/webhooks/clerk` to public routes in `landing-page/src/middleware.ts` (webhooks have no Clerk session):

```typescript
const isPublicRoute = createRouteMatcher([
  "/",
  "/privacy",
  "/terms",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/webhooks(.*)",  // <-- add this
]);
```

# Phase 30A — Clerk Org Sync

> Make Clerk orgs + members fully visible in the commandra dashboard. Clerk is the source of truth for cloud — sync it properly so admins can manage members.

## Scope

- Clerk webhook sync (org members appear in dashboard immediately)
- Two roles: `admin` and `member` (everyone can do everything, except only admins can add/remove members)
- Org context in dashboard UI
- No self-hosted org management yet (Phase 30A-SH)
- No SSO yet (Phase 30C)

## Sub-phases

| Step | File | What | Effort |
|------|------|------|--------|
| 30A-1 | [01-webhook-handler.md](./01-webhook-handler.md) | Clerk webhook handler in landing-page | Small |
| 30A-2 | [02-sync-endpoint.md](./02-sync-endpoint.md) | Commandra sync API endpoint | Small |
| 30A-3 | [03-admin-member-roles.md](./03-admin-member-roles.md) | Admin/member role enforcement on org routes | Small |
| 30A-4 | [04-dashboard-org-ui.md](./04-dashboard-org-ui.md) | Dashboard org page + org context in sidebar | Small |

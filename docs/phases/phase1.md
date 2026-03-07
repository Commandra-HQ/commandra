# Phase 1 — Auth + Shell UI

## Goal

User can install the extension, sign up / log in via Clerk, and see the app shell. Backend verifies auth and creates a user record in Postgres. No agent functionality yet — just the authenticated skeleton.

## What Ships

### Extension (Side Panel)
- Clerk sign-up / sign-in flow embedded in the side panel
- After auth: app shell with tab bar (Chat, Flows, Settings)
- Chat tab: empty state with placeholder ("Navigate to any web app and start chatting")
- Flows tab: empty state ("No flows yet")
- Settings tab: shows user email, sign-out button, backend connection status
- Persistent auth — token stored in chrome.storage, survives browser restart

### Extension (Background)
- Service worker manages Clerk session
- Passes auth token to side panel and content script
- Opens side panel on extension icon click

### Backend (API)
- `GET /api/auth/me` — verify Clerk token, return user info
- `POST /api/auth/sync` — on first login, create user record in Postgres (clerkId + email)
- Health check at `/health`

### Database
- `users` table populated on first login
- Drizzle migration runs cleanly

## Out of Scope
- Page indexing
- Chat / agent functionality
- WebSocket connection (not needed until Phase 4)
- Content script interactions

## How to Verify
1. `make setup` — installs deps, starts Postgres, runs migrations
2. `make dev` — starts API + extension dev server
3. Load extension in Chrome (chrome://extensions, load unpacked from `apps/extension/dist`)
4. Click extension icon — side panel opens with Clerk login
5. Sign up with email — redirected to app shell
6. Settings tab shows email and "Connected" status
7. Close and reopen browser — still logged in
8. Click sign out — returns to login screen

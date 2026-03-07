# Phase 1 — Auth + Shell UI

## Goal

User can sign in via the admin dashboard (Clerk), generate a token, paste it into the Chrome extension, and see the app shell. Backend verifies auth and creates a user record in Postgres. No agent functionality yet — just the authenticated skeleton.

## Architecture

Auth uses a **two-app approach**:

1. **Admin Dashboard** (`apps/web`) — Next.js app at `localhost:3000` with Clerk for sign-in/sign-up. Users generate an extension token from the dashboard.
2. **Chrome Extension** (`apps/extension`) — Thin client. User pastes the token from the dashboard. Token is validated against the API and stored in `chrome.storage.local`.

This avoids Chrome MV3 CSP issues with Clerk's prebuilt components (they require external script loading which is blocked by the extension sandbox).

## What Ships

### Admin Dashboard (`apps/web` — Next.js)
- Clerk sign-in / sign-up at `/sign-in` and `/sign-up`
- Dashboard page showing account info and "Connect Chrome Extension" section
- Token generation with inline copy-to-clipboard (client component, no React Query needed — single fetch)
- `GET /api/extension/token` — returns a Clerk session token for the authenticated user
- Clerk middleware protects all routes except auth pages

### Tech Decisions
- **No React Query / TanStack Query** — overkill for Phase 1. Simple `fetch` + `useState` is enough. Revisit if query complexity grows.
- **No state management library** — React state is sufficient for now

### Extension (Side Panel)
- Login screen with instructions: go to dashboard, sign in, generate token, paste it
- Token validation against `POST /api/auth/me`
- After auth: app shell with tab bar (Chat, Flows, Settings)
- Chat tab: empty state placeholder
- Flows tab: empty state placeholder
- Settings tab: shows user email, backend connection status, disconnect button
- Persistent auth — token + user stored in `chrome.storage.local`, survives browser restart

### Extension (Background)
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
2. `make dev` — starts API + dashboard + extension dev server
3. Open `localhost:3000` — sign up with Clerk
4. On dashboard, generate an extension token and copy it
5. Load extension in Chrome (`chrome://extensions`, load unpacked from `apps/extension/dist`)
6. Click extension icon — side panel opens with token login
7. Paste token — redirected to app shell with tabs
8. Settings tab shows email and "Connected" backend status
9. Close and reopen browser — still logged in
10. Click "Disconnect" — returns to login screen

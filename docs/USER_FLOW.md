# User Flow — End to End

## First-Time Setup

### Step 1: Sign Up & Install

```
User signs up (email + password, or SSO later)
    → Downloads Chrome extension from Web Store
    → Extension icon appears in browser toolbar
    → Opens welcome screen in side panel
```

### Step 2: Add a Website

This is the critical onboarding step. Before the agent can do anything useful, it needs to understand the application.

```
┌─────────────────────────────────────────────────┐
│  Welcome to Commandra                            │
│                                                 │
│  Let's set up your first website.               │
│  Navigate to any internal app and click below.  │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │  Current page:                            │  │
│  │  https://erp.company.com/dashboard        │  │
│  │                                           │  │
│  │  [Index This Website]                     │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  Or paste a URL: ________________________       │
│                                                 │
└─────────────────────────────────────────────────┘
```

User clicks **"Index This Website"** and the setup crawl begins.

### Step 3: Setup Crawl (One-Time, ~10-15 min)

This happens once per website. The extension systematically crawls every page.

```
┌─────────────────────────────────────────────────┐
│  Indexing: erp.company.com                      │
│                                                 │
│  ████████████████░░░░░░░░░░  62%               │
│  127 of ~205 pages indexed                      │
│                                                 │
│  Currently indexing: /invoices/list              │
│                                                 │
│  Found so far:                                  │
│  ├── 127 pages                                  │
│  ├── 1,842 interactive elements                 │
│  ├── 23 forms                                   │
│  ├── 18 data tables                             │
│  └── 340 navigation links                       │
│                                                 │
│  ⓘ You can keep working. Indexing runs          │
│    in background tabs.                          │
│                                                 │
│  [Pause]  [Skip to Chat (partial index)]        │
│                                                 │
└─────────────────────────────────────────────────┘
```

**How it works:**
1. Extension reads all links on the current page
2. Opens pages in hidden background tabs (2-3 at a time)
3. Content script extracts structure from each page (elements, forms, tables, nav)
4. Closes tab, moves to next page
5. Discovers new links as it goes (crawls the full site graph)
6. Skips: logout links, download links, duplicate URL patterns (/invoices/123 and /invoices/456 are the same template)

**Why at setup time?** The agent is dramatically better when it knows the entire app upfront:
- It can plan multi-page workflows ("go to invoices, then to the export page")
- It knows which pages have which forms and tables
- It can suggest actions the user didn't know were possible
- It doesn't waste LLM tokens figuring out the UI on every interaction

**Incremental updates:** After the initial crawl, the extension re-indexes pages as the user visits them naturally. If the UI changes, the index updates automatically.

### Step 4: Website Ready

```
┌─────────────────────────────────────────────────┐
│  ✓ erp.company.com is ready!                    │
│                                                 │
│  I indexed 205 pages and found:                 │
│  ├── Invoice management (create, list, detail)  │
│  ├── Expense reporting (submit, approve)        │
│  ├── Vendor management (profiles, contacts)     │
│  ├── Reports (financial, operational)           │
│  └── Settings & admin                           │
│                                                 │
│  Try asking me something:                       │
│  • "How many invoices are pending?"             │
│  • "Show me the expense submission form"        │
│  • "What reports can I generate?"               │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ Type a message...                         │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  [Add Another Website]                          │
│                                                 │
└─────────────────────────────────────────────────┘
```

The LLM summarizes what it found — page categories, key features — so the user immediately knows what's possible.

---

## Daily Usage

### Opening the Extension

User navigates to any indexed website → clicks extension icon or uses hotkey → side panel opens with chat.

The extension detects which indexed site the user is on and loads the relevant context.

```
┌─────────────────────────────────────────────────┐
│  erp.company.com                   [⚙] [✕]     │
│  Page: Invoice Dashboard                        │
│─────────────────────────────────────────────────│
│                                                 │
│  [Chat]  [History]  [Settings]                   │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ Welcome back. You're on the Invoice       │  │
│  │ Dashboard. I can see 234 invoices.        │  │
│  │ What would you like to do?                │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ Find all overdue invoices over $5K        │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Managing Websites

Users can add multiple websites. Each gets its own index.

```
┌─────────────────────────────────────────────────┐
│  Your Websites                                  │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ erp.company.com                           │  │
│  │ 205 pages · Last updated 2 hours ago      │  │
│  │ [Re-index]  [Remove]                      │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ hr.company.com                            │  │
│  │ 89 pages · Last updated 1 day ago         │  │
│  │ [Re-index]  [Remove]                      │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  [+ Add Website]                                │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## The User Journey (Summary)

```
Sign up → Install extension → Add website → Setup crawl (10-15 min, one-time)
    │
    ▼
Chat with the agent on any indexed page
    │
    ├── One-time tasks: "Download all pending invoices as CSV"
    │
    ├── Select & instruct: hover over table → "Export this data"
    │
    ├── Multi-step workflows: "Do the monthly close across 3 apps"
    │
    ▼
Agent learns your preferences and gets better over time
    │
    ▼
Manage everything from the extension side panel
```

The key insight: **indexing at setup time is what makes everything else work.** Without the index, the agent is just another generic browser AI guessing at the UI. With it, the agent already knows every page, form, table, and button — it just needs the user to say what to do.

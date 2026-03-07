# Agents for Everyone

**Cursor for internal dashboards.** Chat with any web application. Automate what you do every day.

Enterprise employees waste hours on repetitive tasks across internal tools — SAP, Salesforce, custom ERPs, HR portals. These sit behind SSO, VPNs, and MFA. No external AI can access them. We can.

## The Problem

A Deloitte consultant opens 4 internal dashboards every morning. Downloads reports. Copies numbers into a spreadsheet. Sends an email summary. Every. Single. Day.

They can't use ChatGPT for this — it can't see their internal apps. They can't write Selenium scripts — they're not engineers. UiPath costs $10K/year and needs IT to set up.

## The Solution

A Chrome extension that lets anyone automate tasks on any web application through natural language.

```
You:    "Go to the invoice dashboard, find all unpaid invoices
         over $5K, and send a reminder to each vendor"

Agent:  "I found 12 unpaid invoices over $5K. Here's my plan:
         1. Filter invoices by status=unpaid, amount>5000
         2. For each one, click 'Send Reminder'
         3. Confirm each send

         [Execute]  [Edit Plan]  [Save as Flow]"
```

The agent understands the app because it has already indexed it — every button, form, table, and navigation path. It doesn't guess. It knows.

## How It Works

1. **Install** the Chrome extension
2. **Index** — extension maps your web app (pages, buttons, forms, tables)
3. **Chat** — tell the agent what to do in plain English
4. **Select** — point at elements for precise control ("this table → export as CSV")
5. **Save** — promote one-time tasks to reusable flows
6. **Automate** — flows become agents that run on schedule or triggers

## Key Principles

- **Data stays in the browser** — we see page structure, never your actual data
- **Safety first** — destructive actions blocked by default, approval gates on writes
- **Open source** — self-host with Docker, bring your own API key
- **Truly agentic** — powered by Claude Agent SDK with multi-agent coordination

## Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design and how the pieces fit together
- [FEATURES.md](./FEATURES.md) — user flows, capabilities, and product thinking
- [TECH_STACK.md](./TECH_STACK.md) — technology choices and why

## License

MIT

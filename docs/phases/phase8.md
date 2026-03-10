# Phase 8 — Data Tools

Phase 7 gave the agent a brain (orchestrator, memory, vision). Phase 8 gives it hands for data — the ability to read, scroll, wait, and export. These are the tools that make the agent actually useful for enterprise workflows: "read this table", "wait for the report to load", "scroll down and find the total", "export as CSV."

## What Ships

- **4 new browser tools:** `scroll`, `wait_for_element`, `read_text`, `read_table`
- **1 new backend-only tool:** `export_data` (CSV/JSON generation from extracted data)
- **Extension handlers** for scroll, wait, read_text, read_table actions
- **Safety classifications** for all new tools (all read-only → safe)
- **Updated system prompt** so the agent knows when to use data tools vs action tools

## New Tools

### scroll

Scroll the page or scroll a specific element into view. Critical for pages with long tables, infinite scroll, or content below the fold.

```typescript
{
  name: 'scroll',
  description: 'Scroll the page in a direction, or scroll a specific element into view.',
  parameters: {
    type: 'object',
    properties: {
      direction: {
        type: 'string',
        enum: ['up', 'down', 'top', 'bottom'],
        description: 'Direction to scroll the page'
      },
      selector: {
        type: 'string',
        description: 'CSS selector of element to scroll into view (overrides direction)'
      },
      amount: {
        type: 'number',
        description: 'Pixels to scroll (default 500). Ignored if selector is provided.'
      }
    }
  }
}
```

**Extension handler:** Either `window.scrollBy()` for directional scrolling or `element.scrollIntoView()` for selector-based. Returns new scroll position and whether page has more content below.

**Safety:** Always safe (read-only viewport change).

### wait_for_element

Wait for an element to appear, disappear, or become visible. Essential for SPAs, loading states, modals, and AJAX-heavy enterprise apps.

```typescript
{
  name: 'wait_for_element',
  description: 'Wait for an element matching a CSS selector to appear on the page, or for a loading state to resolve.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector to wait for'
      },
      state: {
        type: 'string',
        enum: ['visible', 'hidden', 'attached'],
        description: 'What state to wait for. "visible" = element exists and is visible. "hidden" = element is gone or hidden. "attached" = element exists in DOM (may be hidden). Default: "visible".'
      },
      timeout: {
        type: 'number',
        description: 'Max milliseconds to wait (default 10000, max 30000)'
      }
    },
    required: ['selector']
  }
}
```

**Extension handler:** Uses `MutationObserver` + polling loop. Checks every 200ms, resolves when condition met or timeout expires. Returns the element's label/text on success.

**Safety:** Always safe (no DOM mutation).

### read_text

Extract text content from an element or set of elements. More targeted than `get_page_state` — returns actual content, not just labels.

```typescript
{
  name: 'read_text',
  description: 'Extract the text content from one or more elements matching a CSS selector. Returns the visible text.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of element(s) to read text from'
      },
      all: {
        type: 'boolean',
        description: 'If true, read text from ALL matching elements (querySelectorAll). Default: false (first match only).'
      },
      maxLength: {
        type: 'number',
        description: 'Max characters to return per element (default 2000). Prevents huge payloads.'
      }
    },
    required: ['selector']
  }
}
```

**Extension handler:** `querySelector(All)` → `textContent.trim()`, truncated to maxLength. Returns array if `all: true`.

**Safety:** Always safe (read-only).

**Privacy note:** This tool returns actual page content (text values), which gets sent to the LLM. The system prompt already instructs the agent to use this only when the user explicitly requests data extraction. We do NOT proactively read content — only on user instruction.

### read_table

Extract a table as structured JSON. The enterprise killer feature — turns any HTML table into data the agent (or user) can work with.

```typescript
{
  name: 'read_table',
  description: 'Extract an HTML table as structured JSON data. Returns headers and rows. Works with standard <table> elements and common data grid patterns.',
  parameters: {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector of the table element (or a container with <table> inside it)'
      },
      maxRows: {
        type: 'number',
        description: 'Max rows to return (default 100). Use for large tables to limit payload.'
      },
      includeLinks: {
        type: 'boolean',
        description: 'If true, include href values for links in cells. Default: false.'
      }
    },
    required: ['selector']
  }
}
```

**Extension handler:**
1. Find `<table>` — if selector targets a container, look for `<table>` inside it
2. Extract headers from `<thead>` or first `<tr>` with `<th>` elements
3. Extract rows from `<tbody>` — each row becomes `Record<string, string>` keyed by header
4. Handle colspan/rowspan gracefully (flatten to nearest header)
5. Handle data grids that use `<div>` with `role="grid"` / `role="row"` / `role="cell"`
6. Return `{ headers: string[], rows: Record<string, string>[], totalRows: number, truncated: boolean }`

**Safety:** Always safe (read-only).

**Privacy note:** Same as read_text — returns actual data values. Only used when user explicitly asks.

### export_data

Backend-only tool — no extension handler needed. Takes structured data (from read_table or any tool result) and formats it as CSV or JSON for download.

```typescript
{
  name: 'export_data',
  description: 'Convert structured data to CSV or JSON format. Returns the formatted content as a string that can be displayed or downloaded.',
  parameters: {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        description: 'Array of objects to export',
        items: { type: 'object' }
      },
      format: {
        type: 'string',
        enum: ['csv', 'json'],
        description: 'Output format. Default: csv.'
      },
      filename: {
        type: 'string',
        description: 'Suggested filename (without extension). Default: "export".'
      }
    },
    required: ['data']
  }
}
```

**Implementation:** Pure backend — no WS roundtrip. CSV uses comma delimiter, proper quoting for values with commas/newlines. JSON is pretty-printed.

**Delivery to user:** The tool returns the formatted string + suggested filename. The orchestrator streams it to the extension. The extension renders a download button in the chat UI that triggers a Blob download.

**Safety:** Always safe (generates data, doesn't modify anything).

## Extension Changes

### New action handlers in ws-client.ts

Four new `else if` branches in `handleActionRequest`:

```
scroll       → scrollInPage(direction, selector, amount)
wait_for_element → waitForElementInPage(selector, state, timeout)
read_text    → readTextInPage(selector, all, maxLength)
read_table   → readTableInPage(selector, maxRows, includeLinks)
```

Each is an inline function injected via `chrome.scripting.executeScript` — same pattern as existing tools.

### Download button in ChatTab

When the agent uses `export_data`, the response includes a `<!--download:{filename,format,content}-->` marker. ChatTab parses this and renders a download button that creates a Blob URL and triggers `<a download>`.

## Safety Classifications

All new tools added to classifier.ts:

| Tool | Default Level | Reason |
|------|--------------|--------|
| scroll | safe | Viewport change only |
| wait_for_element | safe | Observation only |
| read_text | safe | Read-only extraction |
| read_table | safe | Read-only extraction |
| export_data | safe | Data formatting, no side effects |

## System Prompt Updates

Add to the agent's base prompt:

```
When the user wants to READ or EXTRACT data from the page:
- Use read_text to get text content from specific elements
- Use read_table to extract tables as structured data
- Use scroll if content is below the fold or the page needs scrolling
- Use wait_for_element if content is loading (spinners, skeleton screens, AJAX)
- Use export_data to format extracted data as CSV or JSON for download

Prefer read_table over read_text for tabular data — it returns structured headers and rows.
Prefer get_page_state for understanding page structure, read_text/read_table for actual content.
```

## Implementation Order

```
Step 1: scroll tool (backend def + extension handler)
        → simplest new tool, validates the pattern for adding tools

Step 2: wait_for_element tool (backend def + extension handler)
        → MutationObserver pattern, needed by read_table for loading states

Step 3: read_text tool (backend def + extension handler)
        → basic extraction, validates read pattern

Step 4: read_table tool (backend def + extension handler)
        → the big one — table parsing logic + role="grid" support

Step 5: export_data tool (backend only, no WS)
        → CSV/JSON generation + download UI in ChatTab

Step 6: Safety + prompts update
        → Add all tools to classifier, update system prompt

Step 7: Integration test
        → End-to-end: chat asks to read a table → agent calls read_table → export_data → download
```

## What's NOT in Phase 8

- Pagination handling (auto-clicking "Next" to read all pages of a table) — that's orchestrator logic, the tools just read what's visible
- Data transformation/filtering (sorting, deduplication) — the LLM handles this in its response
- Saving extracted data to Postgres — Phase 9 (dashboard agents) will persist task results
- Clipboard integration — future nice-to-have
- Excel/PDF export — CSV and JSON cover 90% of enterprise needs

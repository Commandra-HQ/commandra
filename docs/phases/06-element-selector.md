# Phase 6 — Element Selector

## What Ships
User can hover over any element to see a DevTools-style highlight, click to select it, or drag to select multiple elements in an area. Selected elements appear as a chip in the chat input and provide exact selectors to the agent.

## How It Works

### Selector Mode
Activated via ⊕ button in ChatTab. Routes through background script which injects selector code via `chrome.scripting.executeScript` (same reliable pattern as action execution — doesn't depend on content script).

### Single Element (Click)
1. User clicks ⊕ → banner appears: "Element Selector — Click to pick, drag to select area, Esc to cancel"
2. Mouse moves → blue highlight overlay tracks hovered element
3. Tooltip shows: `tag#id.class "label" WxH`
4. Click → captures element info (selector, fallbacks, tag, label, attributes)
5. Side panel shows chip: `<button> "Submit Order"` with ✕ to dismiss
6. User types instruction → agent gets exact selector in system prompt

### Multi-Element (Drag)
1. User clicks ⊕
2. Mousedown + drag → dashed blue selection rectangle drawn
3. Mouseup → all interactive elements whose center falls inside the rectangle are captured
4. Side panel shows chip: "5 elements selected (button, input)"
5. Agent gets all selectors listed in system prompt

### Visual Elements (injected into page)
- **Highlight**: fixed blue border + tint overlay tracking hovered element
- **Tooltip**: monospace pill showing tag, id/class, label preview, dimensions
- **Drag rectangle**: dashed blue border
- **Banner**: dark bar at top of page with instructions

All UI elements use `pointer-events: none` and `z-index: 2147483646+`.

## Architecture
```
ChatTab ⊕ click
  → chrome.runtime.sendMessage({ type: 'SELECTOR_START', payload: { tabId } })
  → Background: chrome.scripting.executeScript({ func: startSelectorInPage })
  → Page: overlay + listeners set up via window globals
  → User clicks/drags
  → chrome.runtime.sendMessage({ type: 'ELEMENT_SELECTED', payload: SelectedElement[] })
  → ChatTab receives, shows chip, includes in /api/chat request
  → Backend injects into system prompt
```

## Files
| File | Role |
|------|------|
| `src/content/selector.ts` | Self-contained injectable functions (`startSelectorInPage`, `stopSelectorInPage`) |
| `src/background/index.ts` | SELECTOR_START/STOP handlers inject via executeScript |
| `src/sidepanel/tabs/ChatTab.tsx` | ⊕ button, chip UI, multi-select display |
| `apps/api/src/routes/chat.ts` | Accepts `selectedElements[]`, injects into system prompt |
| `packages/shared/src/types/messages.ts` | `SelectedElement` type |

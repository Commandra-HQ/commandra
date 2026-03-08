# Phase 6 — Element Selector

## What Ships
User can hover over any element on the page to highlight it, click to select it, and then instruct the agent about that specific element. Eliminates ambiguity — instead of "click the submit button," the user points at the exact element.

## Architecture

### Selector Mode Flow
```
User clicks 🎯 button in ChatTab
  ↓
Side panel sends SELECTOR_START to content script
  ↓
Content script enters selector mode:
  - mouseover → highlight overlay follows cursor
  - click → capture element info, exit mode, send to side panel
  - Escape → cancel selector mode
  ↓
Side panel receives ELEMENT_SELECTED message
  ↓
Selected element shown as chip above chat input
  ↓
User types instruction → sent to backend with selectedElement context
  ↓
Agent uses the exact selector from the selected element
```

### Highlight Overlay
- Single `<div>` overlay positioned absolutely over the hovered element
- Uses `getBoundingClientRect()` for positioning
- Semi-transparent blue background + blue border (like DevTools)
- Small tooltip label showing element tag + text preview
- `pointer-events: none` on overlay so it doesn't interfere with hover detection
- Removed from DOM when selector mode exits

### Element Capture
When user clicks an element, capture:
```typescript
interface SelectedElement {
  selector: string;        // Best CSS selector (same priority as indexer)
  fallbackSelectors: string[]; // Alternative selectors
  tag: string;             // tagName
  label: string;           // Text content / aria-label / placeholder
  type?: string;           // input type, role, etc.
  attributes: Record<string, string>; // Key attributes
  rect: { x: number; y: number; width: number; height: number };
}
```

## Implementation

### 1. Content Script: Selector Mode (`src/content/selector.ts`)
New module — handles all selector mode logic:
- `startSelector()` — adds overlay div, attaches mouseover/click/keydown listeners
- `stopSelector()` — removes overlay, removes listeners
- Mouseover handler: position overlay on hovered element, show tooltip
- Click handler: build `SelectedElement` from clicked element, send `ELEMENT_SELECTED` message, exit mode
- Escape handler: cancel and send `SELECTOR_CANCELLED` message
- Ignore clicks on the overlay itself
- Prevent default on click (don't trigger the actual element)

### 2. Content Script: Message Handling (`src/content/index.ts`)
Add message handlers:
- `SELECTOR_START` → call `startSelector()`
- `SELECTOR_STOP` → call `stopSelector()`

### 3. Side Panel: Selector Button + Chip (`ChatTab.tsx`)
- Add 🎯 target icon button next to chat input
- On click: send `SELECTOR_START` to active tab's content script
- Listen for `ELEMENT_SELECTED` → store in state, show chip above input
- Chip shows: `[button] "Submit Order"` with ✕ to deselect
- Listen for `SELECTOR_CANCELLED` → clear selector state
- When sending message with selectedElement: include it in the request body
- After sending, clear the selected element

### 4. Backend: Selected Element Context (`chat.ts`)
- Accept `selectedElement` in request body
- Inject into system prompt: "The user has selected a specific element: [tag] with label '[label]' at selector '[selector]'. When the user refers to 'this element' or 'that', they mean this one. Use the provided selector."
- Agent uses the exact selector — no guessing

## File Changes
| File | Change |
|------|--------|
| `src/content/selector.ts` | NEW — selector mode logic |
| `src/content/index.ts` | Add SELECTOR_START/STOP handlers |
| `src/sidepanel/tabs/ChatTab.tsx` | Selector button, chip UI, message handling |
| `apps/api/src/routes/chat.ts` | Accept selectedElement, inject into prompt |
| `packages/shared/src/types/messages.ts` | SelectedElement type |

## What's NOT in This Phase
- Multi-element selection (select several elements at once)
- Element annotation/labeling UI
- Persistent element bookmarks
- Visual element tree/inspector

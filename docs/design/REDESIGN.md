# Commandra Product UI Redesign

## Context

The landing page (`landing-page/`) has been redesigned with a clinical, high-precision aesthetic inspired by the "Observational Monolith" design system. This document defines how to bring that same visual DNA into the **product dashboard** (`apps/web/`) and **Chrome extension** (`apps/extension/`) — while keeping them usable for daily work.

**The key tension:** The marketing site can be dramatic. The product needs to be functional. We adapt the *palette, typography, and structure* but dial back the density and drama to maintain usability.

---

## 1. What Changes, What Doesn't

### Adopt from the marketing site
- Color palette (dark mode primary, light mode secondary)
- Typography system (Instrument Sans for UI, JetBrains Mono for data)
- 0px border-radius (sharp edges everywhere)
- 1px borders instead of shadows for elevation
- Status color system (green/amber/red)
- Mono-font metadata labels with uppercase tracking

### Do NOT adopt
- Playfair Display serif headlines (marketing only — too editorial for dashboards)
- Extreme type scale contrasts (8px labels next to 72px headlines)
- Isometric visualizations, voxel grids, particle effects
- Ultra-dense "surveillance terminal" layout — dashboards need breathing room
- The dot-grid backgrounds or glass panels (too heavy for daily use)

---

## 2. Color Palette

Use CSS custom properties. Both apps already have `:root` / `.dark` patterns — replace the current values.

### Dark Mode (Primary — default for both apps)

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#0a0a0e` | Page background (slightly warmer than marketing's #050507 for daily use) |
| `--foreground` | `#e8e8f0` | Primary text |
| `--card` / `--surface` | `#101016` | Cards, panels, sidebar bg |
| `--elevated` | `#16161e` | Hover states, active items, nested surfaces |
| `--border` / `--outline` | `#1e1e2a` | All borders, dividers, table lines |
| `--outline-hover` | `#2a2a3a` | Hover borders |
| `--muted-foreground` | `#8f8fac` | Secondary text, placeholders |
| `--dim` | `#4a4a62` | Tertiary text, timestamps, IDs |
| `--primary` | `#e8e8f0` | Primary buttons, active nav |
| `--primary-foreground` | `#0a0a0e` | Text on primary buttons |
| `--success` | `#00e09a` | Running, active, connected, safe actions |
| `--warning` | `#e8a030` | Learning, queued, review-required actions |
| `--error` | `#e84060` | Failed, blocked, destructive |
| `--ring` | `#2a2a3a` | Focus rings |

### Light Mode

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#ffffff` | Page bg |
| `--foreground` | `#111118` | Primary text |
| `--card` / `--surface` | `#f8f8fa` | Cards, panels |
| `--elevated` | `#f0f0f4` | Hover, active |
| `--border` / `--outline` | `#e0e0e8` | Borders |
| `--outline-hover` | `#c8c8d4` | Hover borders |
| `--muted-foreground` | `#6b6b80` | Secondary text |
| `--dim` | `#9898aa` | Tertiary text |
| `--primary` | `#111118` | Primary buttons |
| `--primary-foreground` | `#ffffff` | Text on primary |
| `--success` | `#00b87a` | (Slightly darker for white bg contrast) |
| `--warning` | `#d4901a` | |
| `--error` | `#d03050` | |

### Status Colors in Context

These are the same across light and dark. Use them consistently:

```
RUNNING / ACTIVE / SAFE    → --success (green)
LEARNING / QUEUED / REVIEW → --warning (amber)
FAILED / BLOCKED / ERROR   → --error (red)
IDLE / ARCHIVED / DISABLED → --muted-foreground (gray)
```

---

## 3. Typography

### Font Stack

| Role | Font | Where |
|------|------|-------|
| **Interface** | Instrument Sans | All UI text — buttons, labels, navigation, body copy |
| **Data / Code** | JetBrains Mono | Timestamps, IDs, agent names, status labels, code blocks, run logs |

**No Playfair Display in the product.** Serif is for the marketing site only. Page titles in the dashboard use Instrument Sans bold, not italic serif.

### Scale (Dashboard)

| Token | Size | Weight | Usage |
|-------|------|--------|-------|
| `page-title` | 24px | 700 | Page headings ("Agents", "Audit Log") |
| `section-title` | 18px | 600 | Card titles, section headers |
| `body` | 14px | 400 | Default text |
| `body-sm` | 13px | 400 | Secondary descriptions |
| `label` | 11px | 500 | Form labels, table headers |
| `mono-label` | 10px | 400 (mono) | Agent IDs, timestamps, status tags, metadata |
| `mono-sm` | 9px | 400 (mono) | Dense data: run logs, audit streams |

### Scale (Extension Side Panel)

The extension is narrower (~360px). Reduce by ~1px across the board:

| Token | Size |
|-------|------|
| `page-title` | 18px |
| `body` | 13px |
| `mono-label` | 10px |
| `mono-sm` | 9px |

---

## 4. Border Radius

**`0px` everywhere.** This is the single biggest visual shift. Every element gets sharp corners:

```css
--radius: 0px;
```

This affects all shadcn components globally since they use `var(--radius)`.

**Exception:** Avatar/profile images can remain circular (`rounded-full`) — a single round element among sharp edges creates intentional contrast.

---

## 5. Elevation & Depth

**No drop shadows.** Depth is communicated through:

1. **1px borders** — `border-[var(--outline)]` on every card, panel, and section
2. **Tonal stepping** — nested elements are one shade lighter than their parent:
   - Page bg (`--background`) → Card (`--surface`) → Nested element (`--elevated`)
3. **Border brightening on hover** — `--outline` → `--outline-hover`

```css
/* Instead of shadow-md */
.card {
  border: 1px solid var(--outline);
  background: var(--surface);
}
.card:hover {
  border-color: var(--outline-hover);
}

/* Nested card inside a card */
.card .inner {
  background: var(--elevated);
  border: 1px solid var(--outline);
}
```

---

## 6. shadcn Component Overrides

Keep using shadcn — just override the defaults. All overrides happen via CSS variables and the `globals.css` theme block.

### Button

```
Primary:    bg-foreground text-background, 0px radius, no shadow
Secondary:  border border-outline bg-transparent, 0px radius
Ghost:      bg-transparent hover:bg-surface, 0px radius
Destructive: bg-error/10 text-error, 0px radius
```

Remove all `rounded-*` classes. The global `--radius: 0px` handles this.

### Card

```
border border-outline bg-surface, 0px radius
No ring, no shadow
```

### Badge

Status badges should use the status color system:

```
Running:  border-success/20 text-success bg-success/5
Queued:   border-warning/20 text-warning bg-warning/5
Failed:   border-error/20 text-error bg-error/5
Default:  border-outline text-muted-foreground bg-surface
```

Add a `4px` square dot before the label text (the "status pixel" pattern from the marketing site):

```html
<span class="status-pixel bg-success"></span> RUNNING
```

### Input

Ghost-style inputs to match the clinical aesthetic:

```
No background fill
Bottom border only: border-b border-outline
Focus: border-b border-foreground
0px radius
```

### Table

```
No horizontal dividers between cells (use vertical spacing instead)
Alternating row backgrounds: bg-surface on even rows
Mono font for data columns (IDs, timestamps, durations)
Sans font for human-readable columns (names, descriptions)
```

### Dialog / Modal

```
bg-surface border border-outline
backdrop: bg-background/60 backdrop-blur-sm
0px radius
```

### Sidebar

```
bg-surface border-r border-outline
Active item: bg-elevated text-foreground
Inactive: text-muted-foreground hover:text-foreground
```

---

## 7. Iconography

Continue using **lucide-react** (already installed). Preferences:

- Stroke width: 1.5 (thinner than default 2 — matches the clinical feel)
- Size: 16px for inline, 20px for standalone
- Color: `text-muted-foreground` default, `text-foreground` on hover/active

---

## 8. Layout Patterns

### Dashboard Pages

```
┌─────────────────────────────────────────────────┐
│ SIDEBAR (220px)  │  MAIN CONTENT                │
│                  │                               │
│ [Logo]           │  Page_Title          [CTA]    │
│                  │  ─────────────────────────    │
│ ■ Overview       │                               │
│   Agents         │  [Card]  [Card]  [Card]       │
│   Workflows      │                               │
│   Logs           │  [Table / Data Section]       │
│                  │                               │
│ ──────────       │                               │
│ [Settings]       │                               │
└─────────────────────────────────────────────────┘
```

- Sidebar: fixed, `220px`, `bg-surface`, `border-r border-outline`
- Main: scrollable, `px-6 py-6`, `bg-background`
- Page title: `font-sans text-2xl font-bold` (NOT serif italic)
- Metadata below title: `font-mono text-[10px] text-muted-foreground uppercase tracking-widest`

### Extension Side Panel

```
┌──────────────────────┐
│ ■ COMMANDRA      [⚙] │
│ ─────────────────── │
│                      │
│ ■ User message       │
│                      │
│ ■ Agent response     │
│   with actions...    │
│                      │
│ ─────────────────── │
│ [Input field      ▶] │
└──────────────────────┘
```

- Header: `h-10 border-b border-outline bg-surface`
- Chat bubbles: No rounded bubbles. Use left-aligned blocks with status-pixel indicators
- User messages: `text-foreground` with `■` dot in foreground color
- Agent messages: `text-muted-foreground` with `■` dot in success color
- Input: Ghost style, bottom border, `font-mono text-sm`

---

## 9. Implementation Plan

### Phase 1: CSS Foundation (both apps)

1. Replace `globals.css` / `styles.css` color variables with the palette above
2. Set `--radius: 0px`
3. Add Instrument Sans + JetBrains Mono via Google Fonts
4. Add status color tokens (`--success`, `--warning`, `--error`)
5. Add the `.status-pixel` utility class
6. Remove all box-shadow usage — replace with border

### Phase 2: shadcn Component Updates

1. Update Button variants (remove rounded, adjust colors)
2. Update Card (border instead of shadow)
3. Update Badge (status color system)
4. Update Input (ghost/bottom-border style)
5. Update Dialog (sharp corners, border)
6. Update Table (alternating rows, mono data columns)

### Phase 3: Dashboard Layout

1. Sidebar: sharp edges, tonal stepping, mono labels
2. Page headers: sans-serif bold + mono metadata
3. Agent cards: status pixels, mono agent names
4. Audit log: mono timestamps, status colors
5. Run history table: alternating rows, mono data

### Phase 4: Extension UI

1. Side panel header: minimal, mono "COMMANDRA" label
2. Chat messages: left-aligned blocks with dot indicators (not bubbles)
3. Activity feed: dense mono layout with status colors
4. Element selector overlay: sharp outline, no rounded highlight
5. Input bar: ghost style with blinking cursor

### Phase 5: Dark/Light Toggle

1. Both apps should support dark (default) and light mode
2. Dashboard: use `next-themes` (same as landing page)
3. Extension: already has `useTheme()` hook — update color values

---

## 10. What "Usable Clinical" Looks Like

The marketing site is atmospheric. The product is a tool. Here's how to bridge:

| Marketing Site | Product Dashboard |
|----------------|-------------------|
| 72px serif italic headlines | 24px sans bold page titles |
| 8px mono metadata | 11px mono labels (readable) |
| 0px padding, edge-to-edge | 24px content padding |
| Dot-grid backgrounds | Clean solid backgrounds |
| Glass panels with blur | Solid cards with borders |
| Animated status pixels | Static status pixels (animate only on change) |
| Isometric visualizations | Standard charts and tables |
| Scanning line effects | None — too distracting for work |

**The vibe:** A Bloomberg terminal that went to design school. Precise, mono-heavy, sharp-edged, but with enough spacing and contrast to stare at for 8 hours without eye strain.

---

## 11. File Reference

| File | Purpose |
|------|---------|
| `landing-page/src/app/globals.css` | Reference implementation — full light/dark palette |
| `landing-page/src/content/landing.json` | Content structure pattern (content separate from layout) |
| `landing-page/src/components/animated-sections.tsx` | Animation patterns (for inspiration, not direct copy) |
| `landing-page/src/components/cta-link.tsx` | Button variant pattern |
| `Downloads/stitch_landing_page_hero/commandra/DESIGN.md` | Original design system spec ("The Observational Monolith") |
| `Downloads/stitch_landing_page_hero/dashboard/screen.png` | Dashboard design reference |
| `Downloads/stitch_landing_page_hero/audit_log_view/screen.png` | Audit log design reference |

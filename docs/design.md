# Design

## Principles

1. **Recall is the product.** Every screen answers "what did I save, and where is it?" Capture and
   settings are secondary.
2. **One obvious input.** `⌘K` (Recall) handles search, URL capture, notes, commands and navigation.
3. **Calm, flat surfaces.** Solid fills, no gradients, no glass, no shadows. Depth comes from
   one-step background shifts, not outlines.
4. **Show provenance.** AI text is labelled, separated from the user's words, and cites sources.
5. **Honest states.** "Import only", "not configured", "lexical only" are visible, not hidden.

## Layout

```
┌────────────┬──────────────────────────────────────────┬─────────────┐
│ Rail       │ Canvas                                   │ Inspector   │
│ Recall     │ Memory map + stream                      │ provenance  │
│ Knowledge  │                                          │ original    │
│ Apps       │                                          │ delete      │
│ Import     │                                          │             │
│ MCP        │                                          │             │
│ Settings   │                                          │             │
└────────────┴──────────────────────────────────────────┴─────────────┘
```

- Rail: 196 px at `lg`, 60 px icon-only at `md`, hidden below `md` with a bottom navigation bar.
- Canvas: max-width 3xl, atlas + day-grouped stream, compact rows.
- Inspector: 300–720 px, drag its left separator (or use arrow keys) and the width persists; the
  header arrow hides it and selecting an item brings it back. Below `lg` it becomes a bottom sheet.
  The middle canvas is flex-sized, so resizing reflows it rather than overlapping.
- Scrolling happens in the canvas and inspector independently; headers stay put.
- Spacing is intentionally tight: 3–4 px unit steps, 12 px gutters, 8 px radius.

## Tokens

Defined in `packages/ui/src/tokens.css` and exposed to Tailwind in `apps/web/src/styles.css` via
`@theme inline`.

| Token                            | Ink (default)               | Use                              |
| -------------------------------- | --------------------------- | -------------------------------- |
| `--canvas`                       | `oklch(0.165 0.012 255)`    | app background                   |
| `--panel`                        | `oklch(0.205 0.012 255)`    | cards, panels                    |
| `--raised`                       | `oklch(0.25 0.014 255)`     | hover/selected                   |
| `--line` / `--line-strong`       | panel / raised              | no visible outlines              |
| `--text` / `--muted` / `--faint` | `0.93` / `0.68` / `0.52`    | hierarchy                        |
| `--signal`                       | amber `oklch(0.81 0.15 78)` | primary action, memory-map cells |
| `--cobalt`                       | `oklch(0.69 0.15 258)`      | links, selection, focus          |
| `--mint`                         | `oklch(0.78 0.12 165)`      | success/connected                |
| `--coral`                        | `oklch(0.7 0.17 25)`        | danger/failed                    |
| `--radius`                       | `8px`                       | cards, buttons, fields           |

Second theme "Paper" is a warm light editorial palette. "Contrast" is black/white with a yellow
signal for accessibility. Themes switch via the icon button in the top-right header (or Settings →
Appearance) and are stored in `localStorage["omnibrain.theme"]`. Ink is the default.

Six flat accent palettes are available in Settings → Appearance: cobalt (default), amber, mint,
coral, violet, slate. The choice sets `data-accent` on `<html>`, is stored in
`localStorage["omnibrain.accent"]`, and drives links, focus rings, badges, AI labels, tags and
selected indicators via `--accent`. Swatches are solid colors; no gradients.

Notifications use [Notch Toast](https://notch.devsethi.me/) mounted once at the app root
(`bottom-center`, floating). Errors are dismissible; success toasts auto-dismiss.

Type: Geist Variable for UI, Geist Mono for metadata, counts, URLs and tags. Base 14 px in app,
16 px reading, tight heading tracking.

Motion: 120–200 ms ease-out for state, `rise-in` for the Recall panel, reduced-motion media query
disables animation.

## Memory map (Atlas)

Atlas is the internal codename for the memory map component; the UI labels it **Memory map**.
The signature view: a 52-week density map.

- Rows are sources with data in the window (max 8), sorted by volume.
- Columns are 52 weeks, aligned to Monday, ending this week; boxes are GitHub-contribution sized.
- Cell alpha scales with count; empty cells are faint raised squares.
- Month labels at the first week of a month; source labels on the left.
- Hover shows `Source · week of date · count`.
- **Drag a box** (or click one cell) to filter by source rows and a date range; the filter chip is
  removable. A single click selects one week/source.
- Canvas is redrawn on resize and theme change; the DOM fallback is the stream itself.
- No graph view. A canvas beats SVG here and avoids physics.
- Selected/filtered cells use the theme accent.

## Recall

Modes are detected by `detectIntent()` in `packages/search`:

| Input                                      | Mode     | Action                      |
| ------------------------------------------ | -------- | --------------------------- |
| `https://…` or `example.com`               | link     | Save URL card, `↵` captures |
| `/…`                                       | command  | Filtered command list       |
| ends with `?` or starts with who/what/how… | question | Search + cited answer       |
| anything else                              | search   | Hybrid results              |

Keyboard: `↑/↓` move, `↵` open/save, `Esc` close, `⌘K`/`Ctrl+K` toggles. Empty query shows recent
items. No results offers "Save as a note".

## Components and states

- `packages/ui`: `Button`, `Badge`, `Card`, `Spinner`, `EmptyState`, `Modal`, `cn`.
- JSON config and MCP results use **Kirari** (`kirari`) with the app palette mapped through
  `--kirari-*` variables.
- MCP keys stay in the list after creation with an eye toggle and copy button; keys created before
  the current page load show `shown only at creation` because only the hash is stored.
- Every data view has **loading** (skeletons), **empty** (instruction + action), **error** (message +
  retry) and **success**.
- Source glyphs are small monospace tiles; status is never colour-only (text or title also present).
- Provenance block: "AI summary · generated", body, "from extracted page text · not the author's
  words".
- Destructive actions are two-step (delete → confirm; disconnect → modal with data choice).

## Accessibility

- WCAG 2.2 AA target: 4.5:1 body text, visible `:focus-visible` outline, 200% zoom.
- All interactive elements are real `<button>`/`<a>`/`<input>`; overlays have `role="dialog"`,
  `aria-modal`, labels, and a close control. Backdrop close is a real button outside the panel.
- Keyboard-only paths: auth, capture, search, list selection, inspector actions.
- `prefers-reduced-motion` disables animations; status text accompanies colour.
- Icon-only buttons carry `aria-label` or `title`.

## Performance budgets (p75 mobile)

| Metric             | Budget                       |
| ------------------ | ---------------------------- |
| Initial JS (gzip)  | ≤ 200 KB (currently ~188 KB) |
| LCP                | ≤ 1.8 s                      |
| INP                | ≤ 200 ms                     |
| CLS                | ≤ 0.05                       |
| Search results p95 | ≤ 400 ms                     |

The memory map is lazy by nature (one canvas). No icon barrel imports; no chart library; fonts are
self-hosted variable subsets.

## Content rules

- Say "import" when it is an import. Say "sync" only when the code syncs.
- Never claim an AI answer without a source chip.
- Empty states teach the next action, not a marketing slogan.
- If a screen could be a generic SaaS screenshot with the logo swapped, redesign it.

## Components

`packages/ui` is the shadcn layer: copy-in components with `cva` variants and `cn` (`clsx` +
`tailwind-merge`). Exports: `Button`, `Badge`, `Card`, `Input`, `Select`, `Separator`, `Spinner`,
`EmptyState`, `Modal` (Radix Dialog), and `Menu` / `MenuTrigger` / `MenuContent` / `MenuItem`
(Radix DropdownMenu). Domain components (rail items, stream rows, memory map) stay bespoke —
shadcn has no equivalent for them.

## Files

- Tokens/themes: `packages/ui/src/tokens.css`, `apps/web/src/styles.css`.
- Shell: `apps/web/src/components/Shell.tsx`.
- Memory map (Atlas): `apps/web/src/components/Atlas.tsx`.
- Recall: `apps/web/src/components/Recall.tsx`.
- Views: `apps/web/src/views/*.tsx`.

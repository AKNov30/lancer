# Lancer — Design System

> Aesthetic: **refined utilitarian** with a terminal-phosphor accent.
> Influences: Linear's restraint, Raycast's typography, Bruno's directness, late-90s amber CRT terminals.
> Anti-influence: Postman's scattered toolbars, Insomnia's purple vibe.

---

## 1. Design principles

1. **Information density wins over generosity.** This is a tool used 8 hours a day. Compact gap-3, padding-3 by default.
2. **Monospace where data lives.** Headers, response bodies, IDs, timestamps, methods. Sans where humans read.
3. **One accent color.** Acid amber. Nothing else fights for attention.
4. **No glassmorphism, no neumorphism, no purple gradients.** Sharp edges, flat surfaces, decisive borders.
5. **Empty / loading / error states are designed surfaces, not afterthoughts.** Each has its own card-shaped composition.
6. **Motion communicates state, not personality.** 150 ms ease-out only. No bounce, no spring, no parallax.

---

## 2. Aesthetic direction

The product feels like a piece of professional gear — a multimeter, not a toy. Surfaces are dark, type is small, contrast is high. The amber accent is the only color "shouting" — it marks _send_, _record_, _active_. Every other element is a shade of zinc.

The visual hook: **the URL bar's caret blinks amber**, like an old terminal prompt. Tiny detail, highly recognizable, costs nothing to ship.

A subtle `1 %` grain noise overlay sits on the app background to break up flat zinc. SVG, not animated.

---

## 3. Typography

| Role | Family | Source | Weight |
|------|--------|--------|--------|
| UI body, labels, buttons | **Plus Jakarta Sans** | Google Fonts (libre) | 400 / 500 / 600 |
| Code, response body, headers, metrics | **JetBrains Mono** | JetBrains (libre, OFL) | 400 / 500 |
| Marketing landing page hero | **Instrument Serif** | Google Fonts (libre) | 400 italic |

**Why these choices:**
- Plus Jakarta Sans → readable at 12 px, distinctive without being weird, not Inter
- JetBrains Mono → developers already know and love it; ligatures off by default (false positives in JSON)
- Instrument Serif → only on the marketing site; gives the brand a memorable hook outside the app

**Fallbacks (literal in `@theme inline` per shadcn skill — avoid the `var(--font-sans)` circular bug):**

```css
--font-sans: "Plus Jakarta Sans", "Plus Jakarta Sans Fallback", ui-sans-serif, system-ui, sans-serif;
--font-mono: "JetBrains Mono", "JetBrains Mono Fallback", ui-monospace, monospace;
--font-display: "Instrument Serif", "Instrument Serif Fallback", ui-serif, Georgia, serif;
```

**Type scale (all `letter-spacing: -0.01em` on sans):**

| Token | Size / Line |
|-------|-------------|
| `text-xs` | 11 px / 16 px — meta, badges |
| `text-sm` | 13 px / 18 px — default body |
| `text-base` | 15 px / 22 px — section headers |
| `text-lg` | 18 px / 24 px — modal titles |
| `text-2xl` | 24 px / 30 px — empty-state headlines |
| `text-mono-sm` | 12 px / 18 px — most monospace surfaces |
| `text-mono-base` | 13 px / 20 px — response body |

---

## 4. Color palette (OKLCH)

Dark mode is the default; the values below populate `@theme inline` directly.

```css
@theme inline {
  /* Surfaces */
  --color-background:     oklch(0.13 0.005 240);      /* near-black, faint cool tint */
  --color-card:           oklch(0.165 0.005 240);
  --color-popover:        oklch(0.18 0.005 240);
  --color-muted:          oklch(0.21 0.005 240);
  --color-border:         oklch(0.245 0.005 240);
  --color-input:          oklch(0.22 0.005 240);

  /* Foreground */
  --color-foreground:         oklch(0.96 0 0);
  --color-muted-foreground:   oklch(0.66 0 0);
  --color-card-foreground:    oklch(0.96 0 0);
  --color-popover-foreground: oklch(0.96 0 0);

  /* Brand: acid amber */
  --color-primary:            oklch(0.86 0.17 92);     /* the only loud color */
  --color-primary-foreground: oklch(0.18 0.02 92);     /* near-black on amber */

  /* Accent (subtle hover, secondary buttons) */
  --color-secondary:           oklch(0.24 0.005 240);
  --color-secondary-foreground: oklch(0.96 0 0);
  --color-accent:              oklch(0.27 0.005 240);
  --color-accent-foreground:   oklch(0.96 0 0);

  /* Status */
  --color-destructive:        oklch(0.62 0.21 27);
  --color-destructive-foreground: oklch(0.99 0 0);
  --color-success:            oklch(0.74 0.18 145);
  --color-warning:            oklch(0.82 0.16 70);
  --color-info:               oklch(0.70 0.13 230);

  /* Method tag colors (in sidebar tree, request list) */
  --color-method-get:    oklch(0.72 0.16 175);   /* teal */
  --color-method-post:   oklch(0.74 0.18 145);   /* green */
  --color-method-put:    oklch(0.78 0.17 70);    /* orange */
  --color-method-patch:  oklch(0.78 0.17 50);    /* deeper orange */
  --color-method-delete: oklch(0.62 0.21 27);    /* red */
  --color-method-head:   oklch(0.66 0 0);        /* gray */
  --color-method-options: oklch(0.66 0.10 280);  /* faint violet */

  /* Focus ring */
  --color-ring: oklch(0.86 0.17 92);

  /* Radius — sharp, not soft */
  --radius:    0.375rem;        /* 6 px */
  --radius-xs: calc(var(--radius) * 0.5);
  --radius-sm: calc(var(--radius) * 0.75);
  --radius-md: calc(var(--radius) * 0.875);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.5);
}
```

Light mode is **post-launch**. Phase 1 ships dark only.

---

## 5. Spacing & density

Compact density throughout:

| Surface | Padding | Gap |
|---------|---------|-----|
| Card | `p-4` | `gap-3` |
| List item (sidebar request) | `py-1.5 px-2` | n/a |
| Toolbar | `py-1.5 px-3` | `gap-2` |
| Form row | `py-2` | `gap-2` |
| Modal | `p-6` | `gap-4` |

Default text is `text-sm` (13 px). `text-xs` for badges and meta only.

---

## 6. Iconography

- **Lucide Icons** at `h-4 w-4` (16 px) inline; `h-5 w-5` (20 px) for primary toolbar actions.
- Stroke width `1.5` everywhere (consistent quiet feel).
- HTTP method labels are typographic, **not** icon-based — colored monospace `GET`, `POST` text in 11 px (more readable than glyphs).

---

## 7. Motion

- Duration: **150 ms ease-out** for any UI state change. Anything else is too slow or too fast.
- Page / route transitions: **none**. Instant nav.
- Send button: subtle `0.97` scale on press; that's it.
- Sidebar tree expand: `120 ms` height interpolation.
- Toast: slide-up from bottom-right `200 ms`.
- _No_ skeleton shimmer animations — use static muted bars (faster perceived).

---

## 8. Three-pane app shell

```
┌─────────────────┬──────────────────────────────┬───────────────────────────┐
│ SIDEBAR         │ REQUEST EDITOR               │ RESPONSE VIEWER           │
│ 240–320 px      │ flex 1                       │ flex 1                    │
│                 │                              │                           │
│ Workspace ▾     │ ┌─ Method ─ URL ─────[Send]┐ │ 200 OK · 124 ms · 1.4 KB │
│ ▾ Auth          │ │  POST    /v1/users/{id} │ │                           │
│   • login       │ └─────────────────────────┘ │ ┌Body  Headers  Cookies   │
│   • refresh     │                              │ │  Tests  Console        │
│   • logout      │ Params │ Headers │ Body │ … │ │                         │
│ ▸ Users         │                              │ │  { "id": 42, ...       │
│ ▸ Billing       │ ┌──────────────────────────┐ │                         │
│                 │ │ JSON                     │ │                         │
│ — Mocks ────    │ │ { "name": "{{username}}"│ │                         │
│ ▸ users-mock    │ │ }                        │ │                         │
│                 │ └──────────────────────────┘ │                         │
└─────────────────┴──────────────────────────────┴───────────────────────────┘
                                                  Resizable panels (rwp)
```

Built with `react-resizable-panels`. Persisted layout in `localStorage`.

---

## 9. Component recipes (shadcn primitives → Lancer surfaces)

| Surface | Primitives | Notes |
|---------|------------|-------|
| Sidebar tree | `ScrollArea` + custom `<TreeItem>` (compound component) | No shadcn tree primitive yet — build atop `Collapsible` |
| Request URL bar | `Input` + `DropdownMenu` (method picker) + `Button` (send) | Send button = `variant="default"` (amber primary) |
| Param / header tables | `Table` + `Input` rows + `Checkbox` (enabled) | Inline-editable; click row to toggle |
| Body editor | CodeMirror 6 in a `<Card>`; language tabs above | Mono font, syntax-highlighted |
| Response tabs | `Tabs` (Body / Headers / Cookies / Tests / Console) | `text-sm` tabs, no underline, active = amber bottom border |
| Auth panel | `Tabs` (None / Bearer / Basic / OAuth2 / AWS / API Key) + `Form` | RHF + zod; saved as part of `.bru` |
| Environment switcher | `Select` (top-right) + "Manage envs..." → `Sheet` | Sheet for full editor |
| Command palette (⌘K) | `Command` in `Dialog` | Fuzzy across all collections, requests, recent history |
| Settings | `Sheet` from right; `Tabs` inside | Full-height side sheet, not modal |
| Destructive confirm | `AlertDialog` (never `Dialog`) | "Delete request 'login'? This cannot be undone." |
| Empty workspace | `Card` centered, `Instrument Serif` headline | "Open a folder to begin." + 2 buttons |
| First-run | `Dialog` 480 px wide | Pick folder / Import Postman / OpenAPI |

---

## 10. Method tag — visual treatment

Used in sidebar tree and history list. Always-visible pill at the request row's left edge.

```tsx
<span className="font-mono text-[10px] font-semibold tracking-wider uppercase
                 px-1 py-px rounded-sm
                 text-[var(--color-method-get)]
                 bg-[color-mix(in_oklch,var(--color-method-get)_15%,transparent)]">
  GET
</span>
```

Background is the method color at 15 % opacity (color-mix). Foreground at full saturation. Reads instantly even at 10 px.

---

## 11. Empty / loading / error states

Each has a designed `<Card>`:

- **Empty**: centered `Instrument Serif` headline (the only place the serif appears in-app), 1 line of `text-sm muted-foreground` instruction, 1 primary CTA + 1 secondary.
- **Loading**: static muted skeleton bars, _no_ shimmer. Mono `Sending…` label under the URL bar.
- **Error**: `Alert` component, destructive variant, monospace error body, "Copy as cURL to retry in terminal" secondary action.

**Rule:** never just blank. Every panel has at least an empty state design.

---

## 12. Accessibility commitments

- Every interactive element keyboard-reachable; tab order matches visual top-down, left-right.
- Focus ring: 2 px amber outline + 1 px offset. Always visible, never `outline: none`.
- Min contrast ratio 4.5:1 (foreground/background). Verified with `oklch-contrast` script in CI.
- All icon-only buttons get `<Tooltip>` + `aria-label`.
- Method colors backed up by text label (never color-only).
- Light mode in Phase 2 will reverse foreground/background pairs but keep amber accent.

---

## 13. Reference inspirations (study, don't copy)

| Tool | What we steal |
|------|---------------|
| **Linear** | Density, dark elegance, motion restraint |
| **Raycast** | Command palette UX |
| **Bruno** | Plain-file-on-disk philosophy |
| **VS Code OSS** | Resizable panels, command palette, status bar idioms |
| **Datadog APM** | Dense table layout, mono-heavy info display |
| **k6 dashboards** | Status-color discipline |

---

## 14. Branding (placeholder)

A wordmark is _not_ part of Phase 1. Workmark candidates:
- "Lancer" set in **Instrument Serif italic** — distinctive, almost editorial.
- Or all-caps **Plus Jakarta Sans 700** with `letter-spacing: 0.05em` — utilitarian.

Decide at Phase 1 ship.

Logo idea: a single amber `>` prompt glyph. That's it. Works as favicon, app icon, in dock. Solo dev = needs no logo system.

---

## 15. Feature surfaces beyond one-shot HTTP

The editor is no longer a single request/response box. These surfaces share the
three-pane shell and design language above; each follows the same density, mono,
and single-amber-accent rules.

**Connection modes.** A request carries a `mode` (`http` · `sse` · `websocket` ·
`grpc`), picked next to the method. `http` keeps the classic send/response flow;
the streaming modes swap the send button for **Connect / Disconnect** and route
incoming messages into a **stream panel** (live, append-only, mono) instead of
the response viewer. The send keystroke (`⌘/Ctrl+Enter`) is mode-aware: it sends
HTTP, connects/disconnects SSE & WebSocket, and **calls** gRPC.

**gRPC (unary).** Runtime `.proto` reflection — point at a `.proto`, pick a
service/method, send a unary call. Same status/timing readout as HTTP.

**Scripting & tests.** Pre-request and post-response scripts run around the call;
post-response `lancer.test(...)` assertions render as pass/fail rows in the
**Tests** tab, and `console.log` / `lancer.log` output collects in the
**Console** tab. Scripting errors surface non-destructively (the HTTP request
still ran).

**Collection vs folder identity.** A folder directly under the workspace root is
a **collection** — its own icon and label weight in the tree (`LibraryIcon`,
amber). Collections carry a **description** and **auth** that requests inside
**inherit** unless overridden. Nested folders stay plain.

**Variables.** The URL editor is CodeMirror with `{{ }}` autocomplete and a
**resolved preview** showing the post-substitution URL inline, so you see exactly
what will be sent.

**Cookie manager.** Cookies viewable/editable per the response **Cookies** tab.

**Cancel in-flight.** A running request can be cancelled; the send button
becomes a cancel affordance for the duration.

**Secret handling.** Proxy passwords are stored in the OS **keyring**, never in
plaintext config; exported `.bru`/Postman files **redact** secrets.

---

## 16. Method color — single source

The `--color-method-*` tokens (§4) are surfaced to TS via `src/lib/method-color.ts`:
`METHOD_COLOR` (the canonical `Record<Method, string>` map) and `methodColor(s: string)`
(falls back to `--color-muted-foreground` for unknown methods). Every method-tinted
surface — sidebar tree, tab bar, command palette, history, collection runner,
method picker — imports from there rather than re-declaring the map. The
`isMethod` type-guard lives next to the `Method` type in `src/lib/types.ts`.

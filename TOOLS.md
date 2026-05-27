# Lancer — Toolchain & Stack

Every choice optimized for **(a) zero recurring cost to maintainer**, **(b) small binary**, **(c) fast iteration solo**.

---

## Decision summary

| Layer | Choice | Pinned version (May 2026) |
|-------|--------|---------------------------|
| Desktop shell | **Tauri 2** | 2.x latest stable |
| Core language | **Rust** | edition 2024, stable channel |
| Frontend framework | **React 19** | 19.x |
| TypeScript | **TS 5.6+** | latest |
| Build / dev server | **Vite 7** | latest |
| CSS framework | **Tailwind CSS v4** | 4.x |
| Component primitives | **shadcn/ui (new-york style)** | CLI v4 |
| Component CLI base | `radix-ui` (default) | unified package, post-Feb 2026 |
| Package manager | **pnpm** | 9.x |
| HTTP client (Rust) | `reqwest` | 0.12+ |
| gRPC (Rust, Pro) | `tonic` | 0.12+ |
| Mock HTTP (Rust) | `axum` | 0.7+ |
| WebSocket (Rust, Pro) | `tokio-tungstenite` | latest |
| JS test sandbox | `rquickjs` | 0.6+ |
| Serialization | `serde` + `serde_yaml`, `serde_json` | latest |
| `.bru` parser | hand-written `nom` parser | n/a |
| SQLite (history cache) | `rusqlite` (bundled mode) | 0.31+ |
| Frontend state | **Zustand** + React Query | 4.x / 5.x |
| Forms | **React Hook Form** + zod | 7.x / 3.x |
| Code editor | **CodeMirror 6** | 6.x |
| Diff viewer | `diff-match-patch` (vendored) | n/a |
| Frontend tests | **Vitest** + **Testing Library** | 1.x |
| Rust tests | **cargo nextest** | latest |
| E2E tests | **WebDriverIO + tauri-driver** | latest stable |
| Lint / format | **Biome** (single tool, fast) | 1.x |
| Git hooks | **Lefthook** | 1.x |
| CI | **GitHub Actions** + `tauri-action` | n/a |
| Distribution | GitHub Releases + Microsoft Store | n/a |
| Auto-update | `tauri-plugin-updater` | n/a |
| Payment / licensing | **Lemon Squeezy** + offline JWT | n/a |

---

## 1. Desktop shell — Tauri 2

**Why Tauri:**
- 5–10 MB installer; Electron is 80–250 MB
- Memory ~50 MB idle vs 200+ for Electron
- Rust core means HTTP / gRPC / parsing run native (10–100× faster than JS in webview)
- Mature in 2026: v2 stabilized late 2024, ecosystem matured through 2025

**Alternatives rejected:**
- _Electron_ — bloated; Postman / Insomnia already pay this tax
- _Wails_ — Go-based, smaller community, weaker plugin ecosystem
- _Neutralino_ — too thin, would re-implement OS bridges
- _NW.js_ — dead

**Trade-off accepted:** Tauri's WebView varies per OS (WebView2 on Windows, WebKitGTK on Linux). We commit to a tested matrix and avoid bleeding-edge CSS.

---

## 2. Frontend — React 19 + Vite 7 + TS 5.6

**Why React over Solid / Svelte:**
- Largest ecosystem; shadcn/ui targets React first
- Tauri + React is the most-tested combo (less debugging time)
- For an API client, UI perf bottleneck is in Rust core; React is fast enough
- React 19 server components and `use()` not needed in a desktop SPA — but compiler optimizations and improved hydration help

**Why Vite over Bun / Webpack:**
- Vite 7 is the de facto Tauri default
- HMR < 50 ms on this size of project
- Bun bundler still maturing; conservative choice for solo dev

---

## 3. Styling — Tailwind v4 + shadcn/ui new-york

**shadcn/ui (new-york):**
- Source-copied components → full ownership, no npm version-pinning hell
- Radix UI primitives → accessibility for free
- new-york style matches our refined utilitarian aesthetic better than default
- Use `radix-ui` unified package (post Feb-2026 migration)

**Tailwind v4:**
- `@theme inline` with literal font names (avoids the `var(--font-sans)` circular bug — see DESIGN.md)
- OKLCH color tokens for accurate dark-mode contrast

**Init command:**
```bash
pnpm dlx shadcn@latest init -d --base radix
pnpm dlx shadcn@latest add button card dialog input label select tabs table command dropdown-menu popover tooltip scroll-area separator sheet skeleton badge alert tooltip resizable
```

---

## 4. Rust core libraries

| Crate | Job | Why |
|-------|-----|-----|
| `reqwest` | HTTP client | Industry standard; rustls feature for cert handling; cookie store |
| `tower` + `tower-http` | Middleware (logging, retry) | Composable; standard |
| `axum` | Mock HTTP server | Tokio-native; same author as reqwest |
| `tonic` | gRPC | Pro tier; battle-tested |
| `tokio-tungstenite` | WebSocket | Pro tier; canonical |
| `rquickjs` | JS sandbox for tests | ~600 KB binary impact; capability-based security; safe by default |
| `serde` + `serde_yaml` + `serde_json` | (De)serialization | Standard |
| `nom` | `.bru` parser | Bruno format isn't pure YAML — has block syntax |
| `rusqlite` (bundled) | History cache | No external SQLite needed |
| `keyring` | OS credential store for secrets | macOS Keychain / Win Credential Mgr / GNOME Keyring |
| `tauri-plugin-updater` | Auto-update | Free, signed releases via GitHub |
| `tauri-plugin-dialog` | Native file pickers | First-party |
| `tauri-plugin-fs` | File access (scoped) | First-party |

---

## 5. JS test sandbox — rquickjs

The post-response test runner needs to execute untrusted JS with a Postman-compatible API surface (`pm.test`, `pm.response.json()`, `pm.expect()`).

**Why rquickjs over Node embed / Deno embed:**
- ~600 KB binary cost vs 30+ MB for Deno / Node
- Capability-based: by default no fs / net / process access
- Async-aware (good for `await pm.sendRequest()`)
- Maintained, integrates cleanly with Tokio

**API surface we'll expose** (Postman-compatible subset):
- `pm.response.{status, code, headers, json(), text()}`
- `pm.test(name, fn)` / `pm.expect(value).to.eq(...)` / `.toContain` / `.toMatch`
- `pm.environment.get/set/unset`
- `pm.collectionVariables.*`
- `pm.sendRequest(req, cb)` (Pro tier)

---

## 6. Storage — plain files, no DB for collections

Collections are folders of `.bru` files. SQLite is used **only** for:
- Request history (rolling 500 entries, local cache, evictable)
- Cookie jar (per-environment)
- License key (Pro)
- App settings (window position, recent folders)

**Why not SQLite for collections:**
- Defeats Git diff workflow
- Defeats "open in your editor" workflow
- Defeats `grep` workflow
- Bruno proved plain-file collections work

---

## 7. Frontend libraries

| Library | Job | Notes |
|---------|-----|-------|
| Zustand | Global UI state (active request, sidebar collapsed) | Tiny, no boilerplate |
| TanStack React Query | Tauri command call cache | Even though "API" is local IPC, Query gives us loading / error / cache for free |
| React Hook Form + zod | Forms (request editor, env vars) | Composable, validates on disk write |
| CodeMirror 6 | Body editor (JSON / GraphQL / XML) | Lighter than Monaco; lazy-loaded by language |
| Lucide Icons | Icon set | Stable, 1000+ icons, tree-shakeable |
| react-resizable-panels | Three-pane layout | Used by Cursor, VS Code OSS |
| date-fns | Time formatting | Tiny, tree-shakes |

**Explicitly NOT used:**
- Redux / RTK — overkill for this app
- Styled-components / Emotion — Tailwind handles all styles
- Axios — `fetch` is enough on the JS side; real HTTP is in Rust
- Lodash — modern JS replaces it

---

## 8. Dev tooling

| Tool | Purpose |
|------|---------|
| **pnpm** | Package manager (faster, better disk usage than npm/yarn) |
| **Biome** | One tool for lint + format (replaces ESLint + Prettier; ~10× faster) |
| **Lefthook** | Git pre-commit / pre-push hooks (Biome, type-check, tests) |
| **Vitest** | Unit / component tests for React |
| **Testing Library** | Component testing; user-centric queries |
| **WebDriverIO** + `tauri-driver` | E2E (smoke) tests |
| **cargo nextest** | Faster Rust test runner |
| **cargo deny** | License + advisory check (cron CI) |
| **commitlint** + Conventional Commits | Auto-changelog |

---

## 9. CI / CD

GitHub Actions workflows:
1. **`ci.yml`** — on every PR: Biome, type-check, vitest, cargo test, cargo clippy
2. **`e2e.yml`** — on `main`: smoke E2E on Windows + Linux runners
3. **`release.yml`** — on tag `v*`: build signed Windows + Linux + (later) macOS via `tauri-action`, publish GitHub Release with auto-update manifest
4. **`audit.yml`** — weekly: cargo deny + pnpm audit, file issue if any high CVE

GitHub Actions free for public repos. No paid runner hours expected at this scale.

---

## 10. Distribution

| Channel | Platform | Cost |
|---------|----------|------|
| GitHub Releases | All | $0 |
| Microsoft Store | Windows | $19 one-time dev account |
| Homebrew Cask | macOS (Phase 2) | $0 |
| AUR | Linux (Arch) | $0 |
| Flathub | Linux (Flatpak) | $0 |
| (Eventually) Mac App Store | macOS | $99 / yr (deferred) |

Auto-update: Tauri's first-party `updater` plugin checks our GitHub Releases JSON manifest. Signature verified by public key in binary.

---

## 11. Payment / licensing infrastructure

When Pro launches:

- **Lemon Squeezy** as Merchant of Record. Handles VAT, EU tax, sales tax. ~5 % fee.
- **Webhook** from LS → small Cloudflare Worker (free tier) → signs offline JWT → emails to buyer.
- License key = signed JWT containing email + max-devices + issued-at. Public key embedded in binary. **No phone-home** ever.
- Activate: paste key in Settings → Lancer verifies signature → unlocks Pro.

**Why not call our server:** offline-first ethos, corporate firewalls, fewer moving parts.

The Cloudflare Worker is the _only_ piece of infrastructure that ever runs on our side, and only at sale time. Free tier handles this trivially.

---

## 12. What we are explicitly _not_ building

- A login system
- A team collaboration backend
- Cloud collection storage
- AI proxy / API gateway
- Telemetry / analytics pipeline
- A CMS or marketing platform (landing page = static Vite or Astro on Vercel free)
- A custom font (use libre fonts only)

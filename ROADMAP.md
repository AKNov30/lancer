# Lancer — Roadmap

Three phases. Each phase ships a self-contained product. Shipping a phase is the _only_ trigger to plan the next one.

---

## Phase 1 — Free MVP  (Weeks 1-12)

**Outcome:** A free, locally-runnable, native API client that can replace Postman for 80 % of solo-dev workflows. Distributed via GitHub Releases + Microsoft Store.

**Scope:** see SPEC.md §5 "Phase 1 — Free MVP".

### Milestones

| # | Name | Weeks | Ship criteria |
|---|------|-------|---------------|
| M1 | Project scaffold | 1 | App opens. Tauri + React + shadcn wired. CI green. |
| M2 | First HTTP request | 2 | UI: enter URL, click Send, see response body / status / headers. |
| M3 | Collection format I/O | 2 | Read & write `.bru` files; survive round-trip with Bruno's own files. |
| M4 | Sidebar tree + workspace | 1 | Open a folder, see all `.bru` as a tree, click → load request. |
| M5 | Auth methods | 1 | Bearer / Basic / API Key / OAuth2 CC / AWS SigV4 all working with sample APIs. |
| M6 | Environments + variables | 1 | `{{var}}` substitution from selected env file; switch envs without restart. |
| M7 | OpenAPI 3 importer | 1 | Drop `openapi.yaml` → collection skeleton appears. ≥ 90 % of public petstore-class specs work. |
| M8 | Embedded mock server | 1 | "Start mock from this collection's spec" → axum on user-chosen port → spec-compliant 200/201 with example bodies. |
| M9 | Postman v2.1 importer | 1 | ≥ 95 % of real-world Postman collections (sample 50) parse without error. |
| M10 | Polish + ship | 1 | Auto-update working; signed release; landing page live; HN launch post drafted. |

**Risk gates:**
- After **M2**, if Tauri ↔ React performance is unacceptable on response sizes > 5 MB → spike streaming response across IPC before M5.
- After **M3**, if `.bru` round-trip with Bruno fails on edge cases → decide whether to fork format under `_lancer/` namespace earlier.

**Monetization status:** $0 revenue. Pure adoption phase.

**Telemetry:** opt-in crash reports only (Sentry self-host or Glitchtip free tier).

---

## Phase 2 — Pro tier  (Weeks 13-24)

**Outcome:** $29 one-time Pro unlock launched. Genuinely additive feature set so free tier is not crippled.

### Milestones

| # | Name | Weeks | Ship criteria |
|---|------|-------|---------------|
| P1 | License key system | 1 | Lemon Squeezy webhook → Cloudflare Worker → signed JWT → email. Activate offline by paste. |
| P2 | gRPC client | 2 | Unary + server-streaming + client-streaming + bidi. `.proto` descriptors loaded from disk; reflection optional. |
| P3 | WebSocket + SSE | 1 | Connect, send, see message log. Auto-reconnect, ping/pong. |
| P4 | GraphQL subscriptions | 1 | Same UI as WebSocket but typed via introspection. |
| P5 | AI test generator (BYOK) | 1.5 | "Generate tests for this response" → diff against current; one-click apply. |
| P6 | AI mock data generator | 0.5 | OpenAPI schema → realistic faker output. |
| P7 | Contract testing | 1 | Save baseline OAS; show schema drift report against live response. |
| P8 | CLI runner | 1 | `lancer run ./api-tests --env ci --reporter junit` produces CI-compatible XML. |
| P9 | Multi-tab + split view | 1 | Two requests side by side; tab persistence per workspace. |
| P10 | Themes + Pro polish | 1 | Light mode; 3 community themes; landing page Pro section; launch. |

**Marketing levers (cumulative):**
- 5 deep-dive blog posts ("Lancer vs Postman", "OpenAPI mocking in 30 sec", "BYOK AI without trust issues")
- Hacker News re-launch with Pro
- Sponsor 2-3 dev podcasts in our niche

**Conversion target:** 1 % of Phase 1 free users → Pro within 90 days.

---

## Phase 3 — Ecosystem  (Weeks 25+)

**Outcome:** Lancer is the protocol-fluent dev tool that integrates everywhere a developer already lives.

### Initiatives (parallel, not sequential)

- **VS Code extension.** Open the workspace folder; sidebar shows the `.bru` tree; click → run with environment selector inline. Uses Lancer's CLI under the hood.
- **Plugin registry.** WASM plugins for: custom auth (Hawk, AWS Cognito SRP), custom body formats (CBOR, MessagePack), custom assertions, custom importers.
- **Team workflows _without our backend_.**
  - Environments encrypted via `age` keys committed to repo.
  - Code-owned collections via standard CODEOWNERS.
  - Drift CI: GH Action that runs `lancer run` on PR, comments on regressions.
- **Documentation generator.** Collections → static OpenAPI docs site (single binary, deploy anywhere).
- **Postman runtime importer.** Import & execute `pm.*` runtime scripts faithfully (long tail of Postman migration friction).

**Pricing review:** Consider Pro Team license ($99 one-time × seats with offline-validated device count). Still no subscription.

---

## Beyond the roadmap (optional, depends on traction)

- **macOS** — when revenue covers $99/yr Apple Developer + signing notarization complexity.
- **Mobile companion (Android/iOS)** — only if a clear use-case emerges (probably "view workspace and trigger requests").
- **Self-hostable web frontend** — for teams who want browser access; serves the same `.bru` repo. Read-only first.
- **API designer** — a no-code OpenAPI editor on top of the existing primitives.

These are explicitly _ideas_, not commitments.

---

## What we will _not_ build

- A SaaS team plan with cloud storage
- A proxied AI router
- A user account system
- Mobile apps as primary surface
- Anything that requires us to host shared infrastructure beyond release artifacts

These boundaries are the product. They keep operating cost at zero, keep the binary small, and keep the maintainer's life sustainable.

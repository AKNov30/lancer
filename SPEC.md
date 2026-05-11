# Lancer — Product Specification

**Version:** 0.1 draft  ·  **Date:** 2026-05-08  ·  **Status:** awaiting approval

---

## 1. Vision

A desktop API client that respects developers' time, money, and data. Built so a single maintainer can sustain it indefinitely on $0 of recurring infrastructure cost.

**Tagline:** _Send requests fast._

## 2. Target Users

| Segment | Primary pain | What they pay for today |
|---------|--------------|--------------------------|
| Solo backend / fullstack devs | Postman forces login, telemetry, sync friction | $0–14 / mo Postman |
| Small dev teams (2–10) | Per-seat subscription stings | $14–25 / seat / mo |
| Corporate devs (regulated) | Cloud sync forbidden by infosec | nothing (use cURL, suffer) |
| API-first SaaS teams | Want mock + contract testing without buying full Postman | Postman team plan |
| OSS maintainers | Want collections in repo, not in someone's cloud | Bruno (closest fit) |

**Primary persona:** _Solo / small-team backend developer who has run out of patience with Postman._

## 3. Problem

1. Existing tools (Postman, Insomnia) force account login and push users toward cloud-only workflows that conflict with corporate policy and personal preferences.
2. Free tiers are aggressively trimmed every release; pricing climbs.
3. Closest free alternative (Bruno) is solid for REST but weak on gRPC, WebSocket, SSE, and AI-assisted authoring.
4. No mainstream client treats the collection as a first-class _file in your repo_, mockable locally, runnable in CI, with strong AI ergonomics — and ships as a native (non-Electron) binary.

## 4. Solution

Lancer is a Tauri 2 desktop app that:

- Stores collections as plain `.bru` files (Bruno-compatible) in a folder you choose, so Git is your sync.
- Sends REST, GraphQL, gRPC, WebSocket, SSE.
- Imports Postman v2.1, Insomnia, OpenAPI 3, cURL.
- Spins up a mock server _from your OpenAPI spec_ on `localhost`, no sign-up.
- Runs post-response JS tests in a sandboxed QuickJS runtime.
- Exposes a CLI (`lancer run collection.bru`) so the same tests run in CI.
- Offers AI helpers (test generation, mock data, response explanation) through your own API key — Lancer never proxies AI traffic.

## 5. Scope

> **Update 2026-05-11:** Test runner and sidebar drag-and-drop moved from Phase 1 to deferred — see "Phase 1 deferred" subsection. All other §5 items implemented or in active milestones.

### In scope (Phase 1 — Free MVP)

- REST: GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS
- Auth: None / Bearer / Basic / API Key (header + query) / OAuth 2 client credentials / AWS SigV4
- Body editors: JSON, form-urlencoded, multipart, raw text, binary, GraphQL
- Headers, query params, path params (templated)
- Environments (dev / staging / prod) as files
- Variables: `{{var}}` substitution
- Response viewer: pretty JSON / raw / preview / headers / cookies / timing
- Collections persisted as `.bru` files in user-chosen folder
- Postman v2.1 collection + environment importer (target: 95 %+ of real-world collections parseable)
- OpenAPI 3 importer → instant collection skeleton
- Local mock server from OpenAPI spec (port chosen by user, regenerable)
- History (last 500 requests, on-disk SQLite — local cache only)
- `cURL` paste → request, request → cURL / fetch / axios / Go / Python copy

### Phase 1 deferred (will ship before v1.0)

These were listed as in-scope in §5 but moved to a deferred queue during execution. They land in a v1.0.x patch release or roll into Pro tier:

- **Test runner** (rquickjs JS sandbox for pre/post-response hooks) — deferred to **Phase 2 Pro tier** (natural pairing with the CLI runner already planned there)
- **Sidebar drag-and-drop reordering** — deferred to **v1.0.x polish patch**

### Out of scope (forever, by design)

- Cloud sync of any kind (use Git)
- Hosted accounts / login
- Proxied AI calls
- Built-in collaboration channels (use Git PR comments)
- Telemetry beyond opt-in crash reports

### Phase 2 — Pro tier ($29 one-time)

- gRPC (unary + streaming) via `tonic`
- WebSocket and SSE clients
- GraphQL subscriptions
- AI helpers (BYOK): generate test from response, generate mock data from schema, explain non-2xx, fix broken assertion
- Contract testing: detect schema drift between two OpenAPI snapshots
- **Test runner**: `pre-request` and `post-response` JS hooks in sandboxed QuickJS (moved from Phase 1 — natural pairing with CLI runner)
- CLI runner (`lancer run`) with JUnit output for CI
- Multi-tab + split view
- Custom themes

### Phase 3 — Ecosystem (after Pro launches)

- VS Code extension (read collection from sidebar, run inline)
- Plugin registry (community-built importers, formatters, custom auth)
- Team workflows _without_ infrastructure (everything via Git: PR-able envs, secrets via age / sops, code-owned collections)

## 6. Differentiators

| Vs. competitor | Lancer's edge |
|----------------|---------------|
| Postman | No login, no telemetry, ~5 MB vs 250 MB, no subscription |
| Insomnia | No login, on-disk format, FSL → MIT (vs Apache + Kong) |
| Bruno | Native (not Electron), real gRPC + WS, AI BYOK, mock from OpenAPI |
| Hoppscotch | Native desktop, not browser-bound |
| HTTPie Desktop | Full collection model, mock server, importers |
| Yaak | More mature feature set on day-one Pro launch |

## 7. Core User Workflows

### Workflow A — _"I just escaped Postman"_

1. File ▸ Import ▸ Postman v2.1 collection
2. Pick a folder on disk → Lancer writes `.bru` files
3. Open the folder in your editor; commit to Git
4. Send a request — works identically; auth pre-filled

### Workflow B — _"I have an OpenAPI spec, I want to mock it"_

1. File ▸ New from OpenAPI ▸ select `openapi.yaml`
2. Lancer creates collection skeleton + offers _Start Mock Server_
3. Click _Start Mock_ → `http://localhost:8787` serves spec-compliant fake responses
4. Hit endpoints from your frontend — mock returns example responses

### Workflow C — _"I want my tests to run in CI"_

1. Write JS test in post-response hook (e.g. `expect(res.status).toBe(200)`)
2. Commit collection
3. CI: `lancer run ./api-tests --env ci --reporter junit > results.xml`
4. CI surfaces failures via JUnit XML

## 8. Success Metrics

### Pre-launch (months 1-3, building)

- Working REST + collections + mock + Postman import — _ships at week 12_
- < 15 MB installed footprint
- Cold-start UI < 800 ms on 2020-era laptop

### Soft launch (months 4-6)

- 1 000 GitHub stars in 30 days
- 10 000 downloads in 90 days
- ≥ 30 issues with reproducible bugs (signal of real users)
- HN post above 200 points

### Pro launch (months 6-9)

- 1 % conversion → 100 paying customers in first 90 days
- $2 900 gross / $2 700 net (after Lemon Squeezy 5 %)
- Refund rate < 5 %

### Year 1 target

- 50 000 downloads
- 1 500 paying customers ($43 500 gross)
- Maintainer breaks even on time at any wage > $10/hr equivalent

## 9. Constraints (non-negotiable)

- **No backend services we run.** Ever. If a feature needs a server, it ships as user-runnable Rust or as documentation.
- **No AI proxy.** AI calls hit user's chosen provider directly with the user's key.
- **No external account required.** Distribution via GitHub Releases + Microsoft Store (free dev account).
- **One-time pricing only.** No subscription, no usage caps, no seat tax.

## 10. Monetization

| Tier | Price | What's gated |
|------|-------|--------------|
| Free | $0 | Phase 1 features (above) — unlimited, forever |
| Pro | **$29 one-time** | Phase 2 features + lifetime updates |
| Pro Team (later) | $99 one-time × N seats | + license-key-managed device count |

**Distribution & payment:** Lemon Squeezy as Merchant of Record. They handle VAT in 100+ jurisdictions, refunds, and chargebacks. ~5 % + $0.50 per sale.

**License key validation:** Offline JWT signed by maintainer's key. Public key embedded in binary. No phone-home required (privacy + works in air-gapped corp networks).

**Refund policy:** 14 days, no questions. Build trust over scale.

## 11. Risks & Mitigation

| Risk | P × Impact | Mitigation |
|------|-----------|------------|
| Bruno catches up on AI / gRPC | High × High | Ship MVP fast (12 wk); win on native perf + UX polish; differentiate with OpenAPI mock |
| Postman re-opens free tier | Med × Med | Free tier alone won't undo the trust damage; users still want local-first |
| Tauri 2 ecosystem gaps | Med × Med | Pin to stable; budget time for Rust-side workarounds; keep React surface minimal |
| Solo burnout | High × High | Strict Phase 1 scope; no infrastructure to maintain; auto-update via tauri-updater |
| Windows code-signing reputation | Med × Low | Ship via Microsoft Store ($19 one-time) instead of self-signing; or accept SmartScreen until reputation builds |
| Pricing too low (race to bottom) | Low × Med | $29 is intentional anchoring; raise price in v2 if traction warrants |
| Pricing too high vs free Bruno | Med × Med | Free tier is feature-complete on its own — Pro is genuinely additive (gRPC, AI, CLI) |

## 12. Open Decisions (need user sign-off before code starts)

> **Update 2026-05-11:** Decisions A, C, E confirmed by implementation through M5. B, D, F remain open pending Phase 2 planning.

| ID | Question | Default chosen | User confirms? |
|----|----------|----------------|----------------|
| A | File format | `.bru` Bruno-compat + `_lancer/` namespace for our additions |  ☑ |
| B | License | FSL 1.1 → MIT @ Y2 for free core; Pro closed |  ☐ |
| C | Initial OS | Windows + Linux; macOS deferred |  ☑ |
| D | AI integration | BYOK + Ollama auto-detect only; no proxy |  ☐ |
| E | Working name | "Lancer" |  ☑ |
| F | Monetization model | $29 one-time Pro; no subscription |  ☐ |

Mark ☐ → ☑ in this file, or open a new conversation to change them. Plan and design assume the defaults above.

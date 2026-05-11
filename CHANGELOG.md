# Changelog

All notable changes to Lancer. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org).

## [Unreleased] — Phase 1 Free MVP

### Added

- **HTTP layer**: REST 7 methods, reqwest backend, shared `reqwest::Client` in app state
- **Auth**: 6 methods — None, Bearer, Basic, API Key (header + query), OAuth 2 client credentials with token cache, AWS Signature V4 via `aws-sigv4` crate
- **Collections**: persist as plain `.bru` files (Bruno-compatible), hand-written depth-counted parser, round-trip serialization
- **Workspace**: open any folder, sidebar lists `.bru` files, click to load
- **Environments**: `.bru` env files in `environments/` subdir, single-pass `{{var}}` substitution, OS keyring for secrets (SHA-256 path hash to fit Windows 256-char limit)
- **OpenAPI 3 import**: drop a spec → folder of `.bru` files + env
- **Postman v2.1 import**: collection + env JSON → `.bru` tree, scripts preserved as `_lancer/script:*` blocks (inert pending Phase 2 runner)
- **Mock server**: local axum from any OAS spec, CORS-permissive
- **UI**: dark amber theme (Plus Jakarta + JetBrains Mono + Instrument Serif), 3-pane resizable layout, env switcher, env editor sheet, settings sheet, mock panel
- **Tooling**: Biome (lint + format), Lefthook (pre-commit + commit-msg + pre-push), commitlint (Conventional Commits)
- **Ship infra**: tauri-plugin-updater + signed releases, opt-in Sentry/Glitchtip telemetry

### Security

- Header values reject `\r\n` and other control chars to prevent HTTP request splitting
- OAuth 2 token cache key includes `client_secret` (rotated secrets evict the old token immediately)
- OAuth 2 cache evicts expired entries on insert (no unbounded memory growth)
- JSON body substitution operates on the raw authored string then re-parses; injected `","admin":true,"` becomes a `MaterializeError::InvalidJson`, not silent injection
- OS keyring unavailable returns hard `SecretError::Unavailable` — never silently leaks literal `{{var}}` to upstream

### Documentation

- Full SPEC, TOOLS, DESIGN, ROADMAP
- 7 implementation plans (M1-M4 phase1, M5 auth, M6 envs, M7 OpenAPI, M8 mock, M9 Postman, M10 ship)

## Roadmap to v1.0

- Final code-signing keypair rotation (replace placeholder pubkey in `tauri.conf.json`)
- Microsoft Store submission package
- Landing page deploy at lancer.dev
- HN launch post

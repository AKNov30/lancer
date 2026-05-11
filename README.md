# Lancer

> **Send requests fast.** A free, local-first API client.

[![CI](https://github.com/USERNAME/lancer/actions/workflows/ci.yml/badge.svg)](https://github.com/USERNAME/lancer/actions/workflows/ci.yml)
[![License: FSL-1.1](https://img.shields.io/badge/license-FSL--1.1-blue.svg)](#license)

Lancer is a desktop API client built on Tauri 2 (Rust core, native windowing). It:

- Weighs **5 MB** — not 250 MB like Electron-based tools
- Stays **local** — no login, no telemetry, no cloud sync forced
- Stores collections as **plain `.bru` files** in a folder you choose
- Imports from **Postman v2.1** and **OpenAPI 3** in one click
- **Mocks** any OAS spec on `localhost`, no sign-up
- Supports **6 auth methods** including OAuth 2 client credentials and AWS SigV4

## Why not just use Postman?

| Postman | Lancer |
|---|---|
| Forces login since 2023 | No account, ever |
| Free tier shrinks each release | Free tier stays free, forever |
| 250 MB Electron installer | 5 MB Tauri binary |
| Cloud-first; your data leaves your machine | 100% local; sync via your Git |
| AI features go through their proxy with your data | BYOK to your AI provider |
| Pro: $14–25 per seat per month | Pro: **$29 one-time** |

## Install

### Windows

```powershell
winget install Lancer.Lancer
```

Or download the `.msi` from [Releases](https://github.com/USERNAME/lancer/releases).

### Linux

Download the `.AppImage` from [Releases](https://github.com/USERNAME/lancer/releases). Make it executable:

```bash
chmod +x Lancer-*.AppImage
./Lancer-*.AppImage
```

### macOS

Coming Phase 2.

## Quick start

1. Launch Lancer.
2. Click **Open Folder** in the sidebar. Pick any folder (existing or new).
3. Click **Import** → **OpenAPI** or **Postman** to bring an existing spec in. Or right-click → **New request**.
4. Type a URL, pick a method, click **Send**.

Done. No account, no cloud.

## Features

### Phase 1 (free, today)

- REST: GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS
- Auth: None · Bearer · Basic · API Key · OAuth 2 client credentials · AWS SigV4
- Body editors: JSON · form-urlencoded · multipart · raw text · GraphQL
- Environments (dev / staging / prod) as `.bru` files
- `{{var}}` substitution with secrets in OS keyring
- Collections persist as plain `.bru` files (Bruno-compatible)
- Sidebar tree with click-to-load
- Postman v2.1 collection + env importer
- OpenAPI 3 importer → instant `.bru` tree
- Local mock server from OpenAPI spec
- Opt-in crash reports (off by default)
- Auto-update via signed releases

### Phase 2 (Pro, $29 one-time, coming)

- gRPC (unary + streaming)
- WebSocket + SSE clients
- AI helpers (BYOK to OpenAI / Claude / Ollama)
- Contract testing
- CLI runner for CI
- Multi-tab + split view

See [ROADMAP.md](./ROADMAP.md) for details.

## Architecture

```
+- React 19 + Tailwind v4 + shadcn/ui ----------------------+
|  Sidebar . URL bar . Response viewer . etc.               |
+----------------------------+-------------------------------+
                             | Tauri IPC
+----------------------------v-------------------------------+
|           Rust core (Tauri 2)                              |
|  HTTP (reqwest) . OAuth 2 cache . AWS SigV4               |
|  .bru parser . Env loader . Mock server                   |
|  OS keyring for secrets                                    |
+------------------------------------------------------------+
```

For implementation details see [`SPEC.md`](./SPEC.md), [`TOOLS.md`](./TOOLS.md), and [`DESIGN.md`](./DESIGN.md).

## Contributing

```powershell
# Prerequisites: Node 22+, pnpm 10+, Rust stable, Visual Studio C++ Build Tools (Windows)
git clone https://github.com/USERNAME/lancer
cd lancer
pnpm install
pnpm tauri dev
```

Tests:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1
pnpm test
```

Conventional Commits are enforced by the commit-msg hook. Examples:

- `feat(http): add gRPC client`
- `fix(auth): reject CR/LF in headers`
- `docs(plan): M11 plugin registry`

## License

Free core: **Functional Source License 1.1**, auto-converting to **MIT** 2 years after each release.
Pro tier: proprietary.

See [LICENSE](./LICENSE) (TBD before v1.0 ship).

## Acknowledgments

Built with [Tauri](https://tauri.app), [React](https://react.dev), [shadcn/ui](https://ui.shadcn.com), [reqwest](https://github.com/seanmonstar/reqwest), [axum](https://github.com/tokio-rs/axum). Format compatibility with [Bruno](https://www.usebruno.com).

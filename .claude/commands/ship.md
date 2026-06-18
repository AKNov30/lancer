---
description: Cut a Lancer release through the release-engineer — sync versions, run the full gate, build & sign, publish a GitHub Release with a signed latest.json for the auto-updater.
argument-hint: "[version, e.g. 0.0.5]  (omit to use the current synced version)"
---

# /ship — Release Lancer

## Target version (from user)

$ARGUMENTS

## Pipeline (run as `release-engineer`)

1. **Pre-flight** — confirm with the user before doing anything outward-facing (a tag/release is public and hard to undo). Confirm the working tree is committed and the intended version.
2. **Version sync** — set `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` to the SAME version (they have drifted before). If no version given, verify the three already match.
3. **Full gate** — stop the dev server; run biome, `tsc --noEmit`, `cargo fmt --check`, `cargo clippy -D warnings`, `pnpm test`, `cargo test`, and the bundle-size gate. All green.
4. **Audit** — `cargo audit` + `pnpm audit`; refresh third-party license NOTICES. Block on unpatched criticals.
5. **Build & sign** — `pnpm tauri build` with `TAURI_SIGNING_PRIVATE_KEY` (from `~/.lancer-signing/private.key`, NEVER committed; in CI it's the GitHub secret). Produces installers + `.sig` per platform. Prefer running this via the `tauri-apps/tauri-action` GitHub Actions workflow (build matrix: windows/macos/ubuntu) rather than locally.
6. **Publish** — create the GitHub Release tagged `v<version>`, upload installers + a `latest.json` (version, pub_date, per-platform `{signature, url}`) so the updater endpoint `.../releases/latest/download/latest.json` resolves. **Get explicit user confirmation before publishing.**
7. **Verify** — from a prior install, confirm "Check for updates" sees the new version.

## Hard rules
- $0-infra: GitHub Releases only, no paid hosting.
- NEVER commit or echo the signing private key or any secret.
- macOS notarization + a Windows code-signing cert are needed for fully-trusted installs — flag if missing; an unsigned-OS but updater-signed build still works for the auto-updater.
- Don't publish without explicit user go-ahead.

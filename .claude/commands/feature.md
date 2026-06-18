---
description: Build a Lancer feature end-to-end through the core team — tech-lead specs & delegates, builders implement, reviewers check, qa adds tests. Returns an integrated, gate-green result.
argument-hint: "<feature description>  e.g. 'multipart/form-data request body with file parts'"
---

# /feature — Build a feature through the Lancer team

## Request (from user)

$ARGUMENTS

If empty, ask the user what to build (one short question), then proceed.

## Pipeline

Run this as the **tech-lead** orchestration:

1. **Spec** (`tech-lead`) — goal, acceptance criteria, scope, non-goals. Guard the **$0-infra** rule. If the feature is large or has UX trade-offs, briefly confirm the approach with the user before building (plan-before-code on UI).
2. **Design** (`tech-lead` + `product-designer` if UI) — approach matching existing patterns; list files to touch + build order; design the UI/microcopy if user-facing.
3. **Build** — delegate to the right specialists, parallel where independent, sequential where not (and sequential for cargo — stop the dev server first):
   - `rust-backend-engineer` (commands/transport/storage), `frontend-engineer` (UI/stores), `product-designer` (visual/UX/copy), `cross-platform-engineer` (if OS-touching), `i18n-engineer` (if it adds user-facing strings).
4. **Review** — summon only the relevant reviewer-bench agents (e.g. `security-privacy-reviewer` for anything touching secrets/scripts/imports; `api-client-domain-expert` for protocol correctness; `react-code-reviewer`/`tauri-rust-reviewer`; `ui-design-reviewer`/`ux-flow-reviewer`/`a11y-reviewer` for UI). Fix what they surface.
5. **Test** (`qa-test-engineer`) — add the tests that lock the behavior (reproduce any bug first).
6. **Verify the gate** — `pnpm typecheck` · `pnpm lint` · `pnpm test`; stop dev server → `cargo fmt -- --check` · `cargo clippy --all-targets -- -D warnings` · `cargo test --lib`. Everything green (lefthook will block the commit otherwise). No `.js` shadow files in `src/`.
7. **Report** (`tech-lead`) — Thai prose + English code paths: what changed (`file:line`), what's verified, what's left, risks. Don't commit/push unless the user asks.

## Notes
- Build on current code; match conventions; reuse shared helpers (kvRowsToTuples, isMethod, method-color, status-color, ui/* primitives).
- If a step can't go green, revert that step and report why rather than leaving the tree red.

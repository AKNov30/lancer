## What does this PR do?

Brief description of the change.

## Why is this change needed?

Link to issue if applicable. If not — what's the user problem this solves?

## How was this tested?

- [ ] Existing tests pass: `cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1` AND `pnpm test`
- [ ] New tests added for the change (where applicable)
- [ ] Manually verified: <describe>

## Checklist

- [ ] Commit messages follow Conventional Commits (`type(scope): description`)
- [ ] `cargo clippy -- -D warnings` clean
- [ ] `pnpm lint` clean
- [ ] No new SPEC-§5 features without a plan in `docs/superpowers/plans/`
- [ ] CHANGELOG entry NOT manually added (git-cliff will generate at release)

## Breaking change?

If yes, describe migration path:

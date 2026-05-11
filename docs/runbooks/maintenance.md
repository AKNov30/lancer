# Maintenance schedule

## Weekly (15 min)

- Review GitHub Issues — triage, label, respond to questions
- Skim Glitchtip crash dashboard for recurring errors
- Merge community PRs that pass CI and have tests

## Monthly (1 hour)

- `cargo audit --manifest-path src-tauri/Cargo.toml` — review any new CVEs
- `pnpm audit --prod` — same for npm
- Update Dependabot PRs (lockfile-only) in a batch
- Glance at Sentry/Glitchtip for trends

## Quarterly (3-4 hours)

- Major deps update sprint:
  - Bump non-breaking deps with `pnpm update -L` and `cargo update`
  - Address breaking deps one at a time in their own PR
- Review `cliff.toml` + commit conventions — anything to adjust?
- License renewal: domain registration (Porkbun auto-renew is fine, double-check), Microsoft Partner Center, etc.

## Yearly

- License legal review (FSL terms still appropriate?)
- Tax: reconcile Lemon Squeezy 1099 / equivalent
- Trademark check (any squatters? need to file?)
- Threat-modeling refresh (new attack surfaces added?)

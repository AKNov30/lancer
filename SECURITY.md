# Security policy

## Supported versions

Only the latest released version of Lancer receives security fixes. We recommend keeping auto-updates enabled.

| Version | Supported |
|---------|-----------|
| Latest  | ✅        |
| Older   | ❌        |

## Reporting a vulnerability

**Do NOT open a public GitHub Issue for security reports.**

Report privately via one of these channels:

- **GitHub Security Advisories** (preferred): https://github.com/USERNAME/lancer/security/advisories/new
- **Email**: `security@lancer.dev` (PGP key available on request)

Please include:

1. A description of the vulnerability and its impact
2. Steps to reproduce
3. Affected version(s)
4. Any relevant logs, screenshots, or proof-of-concept

## Our response

- **Acknowledgement** within 72 hours
- **Initial assessment** within 7 days
- **Fix or mitigation** depends on severity:
  - Critical: patch released within 7 days
  - High: within 30 days
  - Medium / Low: rolled into the next regular release

We will credit reporters in the release notes unless you prefer to remain anonymous. We do **not** offer paid bug bounties at this time.

## Scope

In scope:
- The Lancer desktop application binary
- The Tauri command surface (IPC)
- The `.bru` parser and importers (OpenAPI / Postman / cURL)
- The auto-updater path
- The OS keyring integration

Out of scope:
- Third-party servers a user connects Lancer to (this is the user's responsibility)
- Vulnerabilities in dependencies that have published advisories with available upgrades (please file Dependabot PRs instead)
- Social engineering of Lancer maintainers

## Hall of fame

Reporters who've responsibly disclosed issues will be listed here after their report is fixed and released.

_(Empty — be the first!)_

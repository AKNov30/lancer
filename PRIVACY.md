# Privacy policy

_Last updated: 2026-05-11_

Lancer is a **local-first** desktop application. We collect almost nothing.

## What we do NOT collect

- Your account info — there is no account
- Your collections, requests, responses, environment variables, or secrets — all of these stay on your disk
- Telemetry on app usage, screen views, button clicks, etc.
- Analytics, fingerprints, advertising identifiers, or trackers
- Your network traffic — Lancer's HTTP client connects to URLs **you** type; we never proxy anything

## What we MIGHT collect (only with your explicit opt-in)

### Crash reports

If — and only if — you toggle "Send crash reports" ON in Settings → Privacy, Lancer sends crash stack traces to our error-tracking service (Glitchtip or Sentry self-host). Crash reports may include:

- The crash stack trace and error message
- The OS, app version, and platform
- A randomly-generated anonymous device ID

Crash reports do **NOT** include:

- The URL of any request you sent
- Any header value (we redact anything matching `auth|key|token|secret|password|cookie`)
- Any request or response body
- Your environment files or secrets

This setting is **OFF by default**. You can toggle it off at any time; the setting takes effect on next launch.

### Auto-update check

When auto-update is enabled (default ON; toggle in Settings), Lancer makes an HTTPS request to `https://lancer.dev/updates/...` on launch to check for a newer version. The request body is empty; the response is a JSON manifest. We do not log these requests beyond standard CDN access logs (Cloudflare) which are retained for 24 hours and not correlated to any user identity.

## Third parties

- **Cloudflare** (CDN for the update manifest endpoint) — Cloudflare's privacy policy applies to that HTTPS request.
- **GitHub** (release artifact host) — when Lancer downloads an update, it fetches from `releases.githubusercontent.com`. GitHub's privacy policy applies.
- **Glitchtip / Sentry** (crash reports — opt-in only).
- **Lemon Squeezy** (if you purchase a Pro license, Lemon Squeezy as Merchant of Record handles the transaction — their privacy policy applies to the payment data, not the app data).

## Your data, your control

- All your collections, environments, and history are plain files on your disk. Delete them anytime.
- OS keyring secrets are stored by your operating system, not by Lancer. Use your OS's credential manager to view or remove them.
- To remove all Lancer data: delete the app, delete the workspace folder(s) you opened, clear the `Lancer` entries from your OS keyring.

## Children

Lancer is not directed at children under 13 and we do not knowingly collect any data from anyone (children or otherwise) beyond the opt-in crash reports above.

## Changes to this policy

If we change this policy, we'll bump the "Last updated" date and note the change in CHANGELOG.md. If the change materially expands what we collect, we'll surface a one-time notice in the app on next launch.

## Contact

Privacy questions: `privacy@lancer.dev`

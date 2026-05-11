# Runbook — Rollback a bad release

## When to roll back

- New version crashes on launch for a noticeable % of users
- Auto-update broke (existing installs can't update further)
- Security issue discovered post-release
- Critical data loss path identified

Rollback is preferable to "ship a hotfix" if the hotfix would take > 2 hours.

## Steps

### Option A — Promote previous as latest (preferred — fast)

```powershell
# Existing v1.0.0 still has artifacts on GitHub Releases.
# In the lancer-updates repo, point all manifests back to v1.0.0:

cd lancer-updates
# Restore the v1.0.0 manifests (you should have kept them in a versioned folder)
cp public/updates/archive/windows-x86_64/1.0.0.json public/updates/windows-x86_64/latest.json
# (etc for linux-x86_64)
git commit -am "rollback: revert auto-update to v1.0.0"
git push
```

Within 60s, new launches will report "up to date" against v1.0.0 instead of pulling v1.0.1.

**Caveat:** users who already auto-updated to v1.0.1 are stuck on v1.0.1 (tauri-plugin-updater doesn't downgrade). They must manually install v1.0.0 .msi from GitHub Releases.

### Option B — Mark GitHub Release as pre-release

In GitHub Release for v1.0.1: tick "Set as a pre-release" + un-tick "Set as latest release". Combined with Option A this gives users a clear "this version is known broken" signal.

### Option C — Ship v1.0.2 hotfix

If the fix is small + tested, just ship v1.0.2 via the normal `ship-new-version.md` flow. tauri-plugin-updater will offer 1.0.0 -> 1.0.2 and skip 1.0.1.

## Post-mortem

Within 48h of rollback, write a `docs/incidents/YYYY-MM-DD-vX.Y.Z.md` covering:
- Timeline of what happened
- Root cause
- What's added to CI / process to prevent recurrence
- User-impact estimate

This doesn't need to be public unless data loss / security was involved.

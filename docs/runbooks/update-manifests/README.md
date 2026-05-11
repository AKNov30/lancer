# lancer-updates

Static host for Lancer's auto-update manifests. Deployed to Cloudflare Pages.

## Structure

```
public/updates/
├── windows-x86_64/
│   ├── latest.json          # The active manifest tauri-plugin-updater fetches
│   └── archive/             # Old versions for rollback
│       └── 1.0.0.json
└── linux-x86_64/
    └── latest.json
```

## Adding a new release

After Lancer's CI publishes v1.0.1 with manifest artifacts:

```bash
# Archive old latest first (for potential rollback)
cp public/updates/windows-x86_64/latest.json public/updates/windows-x86_64/archive/1.0.0.json
cp public/updates/linux-x86_64/latest.json public/updates/linux-x86_64/archive/1.0.0.json

# Copy new manifests (download from GitHub Release artifacts)
cp ~/Downloads/Lancer_1.0.1_windows-x86_64-manifest.json public/updates/windows-x86_64/latest.json
cp ~/Downloads/Lancer_1.0.1_linux-x86_64-manifest.json public/updates/linux-x86_64/latest.json

git add . && git commit -m "release: v1.0.1" && git push
```

Cloudflare Pages auto-deploys.

## Rolling back

```bash
# Restore the v1.0.0 manifest as latest
cp public/updates/windows-x86_64/archive/1.0.0.json public/updates/windows-x86_64/latest.json
git commit -am "rollback: v1.0.1 -> v1.0.0" && git push
```

See Lancer's `docs/runbooks/rollback.md` for the full procedure.

## Manifest format

See `example-manifest.json` in this folder.

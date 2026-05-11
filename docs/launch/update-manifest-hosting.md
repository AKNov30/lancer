# Update manifest hosting

`tauri-plugin-updater` checks `lancer.dev/updates/{{target}}-{{arch}}/{{current_version}}.json` for new versions. This needs a static host. We use **Cloudflare Pages free tier** for decoupling from GitHub Releases availability.

## One-time setup

### 1. Create the `lancer-updates` repo

A SEPARATE GitHub repo, public, MIT-licensed.

```
lancer-updates/
├── README.md             (see docs/runbooks/update-manifests/README.md template)
└── public/
    └── updates/
        ├── windows-x86_64/
        │   ├── latest.json
        │   └── archive/
        │       └── 1.0.0.json
        └── linux-x86_64/
            └── latest.json
```

### 2. Connect to Cloudflare Pages

- Cloudflare Dashboard -> Workers & Pages -> Create application -> Pages -> Connect to Git
- Repo: `lancer-updates`
- Build command: (none)
- Output directory: `public`
- Production branch: `main`

### 3. Set custom domain

- Custom domains -> Add custom domain -> `lancer.dev` (or subdomain like `updates.lancer.dev`)
- Cloudflare auto-issues TLS cert

### 4. Update tauri.conf.json endpoint

Edit `src-tauri/tauri.conf.json` plugins.updater.endpoints to match your final URL:

```json
"endpoints": ["https://lancer.dev/updates/{{target}}-{{arch}}/latest.json"]
```

(Note: changed from `{{current_version}}.json` to `latest.json` — the manifest at `latest.json` always points to the newest version. This is simpler than per-version files.)

## Per-release workflow

After tauri-action publishes the release artifacts + manifest files:

1. CI or manual step downloads the `*.json` manifests from the release
2. Copies them to `lancer-updates/public/updates/{target}-{arch}/latest.json`
3. Old `latest.json` is moved to `archive/v{old-version}.json` first (for rollback)
4. Commit + push -> Cloudflare Pages deploys in ~60s

See `docs/runbooks/update-manifests/` for the template repo content.

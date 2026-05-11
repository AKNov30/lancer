# Runbook — Ship a new version

Estimated time: 30-60 minutes including manual verification.

## Pre-flight

1. `main` is green on CI: https://github.com/USERNAME/lancer/actions
2. Local working tree is clean: `git status`
3. You're on the latest `main`: `git pull --ff-only`
4. Decide version per [SemVer](https://semver.org):
   - **patch** (1.0.0 -> 1.0.1): bug fixes, no API/UX breaks
   - **minor** (1.0.1 -> 1.1.0): new features, backward-compatible
   - **major** (1.x -> 2.0.0): breaking changes (data format, command signatures)
   - **rc/beta** (1.1.0 -> 1.1.0-rc.1): pre-release

## Steps

```powershell
# 1. Bump the 3 version files
./scripts/bump-version.ps1 -NewVersion 1.0.1

# 2. Sync lockfiles
pnpm install
cargo build --manifest-path src-tauri/Cargo.toml

# 3. Generate CHANGELOG section
pnpm run release

# 4. Manual edit: review CHANGELOG.md, polish wording, add migration notes if any
code CHANGELOG.md

# 5. Verify everything still builds + tests pass
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1
pnpm test
pnpm vite build

# 6. Commit
git add -A
git commit -m "chore(release): v1.0.1"

# 7. Tag + push
git tag v1.0.1
git push origin main --tags

# 8. GitHub Actions runs release.yml automatically:
#    - Builds Windows + Linux artifacts
#    - Signs with TAURI_SIGNING_PRIVATE_KEY secret
#    - Creates DRAFT GitHub Release
```

## Post-CI manual steps

9. **Review the draft release** at https://github.com/USERNAME/lancer/releases
   - Confirm `.msi` + `.AppImage` + `.tar.gz` + signature files attached
   - Paste relevant CHANGELOG section as release notes
   - Tick "Set as latest release"
   - Click **Publish**

10. **Update the updater manifests** at the `lancer-updates` repo:
    ```powershell
    cd ../lancer-updates
    cp ../lancer/src-tauri/target/release/bundle/updater-manifest/*.json public/updates/
    git add . && git commit -m "release: v1.0.1 manifests" && git push
    ```
    Cloudflare Pages deploys within 60s — `lancer.dev/updates/...` URLs now serve the new version.

11. **Verify auto-update works**:
    - Install previous version on a clean VM (or use a separate user profile)
    - Launch — should detect new version + offer install
    - Install + verify app relaunches into v1.0.1

12. **Post-release**:
    - Tweet / HN comment / Reddit (if a notable release)
    - Update landing page version badge (auto from GitHub API on landing)
    - Watch GitHub Issues + Glitchtip for crash reports for 24-48h

## Rollback

If v1.0.1 is broken — see `rollback.md`.

# Lancer signing keys

Tauri's auto-updater requires a keypair to sign release artifacts. The PUBLIC
key is embedded in the binary and verifies every update. The PRIVATE key signs
the manifests in GitHub Actions.

## Generated

The keypair was generated to `~/.lancer-signing/private.key` (outside the
repo). **This file MUST NOT be committed.**

The corresponding PUBLIC key is embedded in `src-tauri/tauri.conf.json` →
`plugins.updater.pubkey`.

## Before v1.0 ship

1. **Move the private key to a password manager** (1Password, Bitwarden).
   Delete the file at `~/.lancer-signing/private.key` once moved.
2. **Add the private key as a GitHub Actions secret**:
   - Secret name: `TAURI_SIGNING_PRIVATE_KEY`
   - Value: the contents of `private.key`
3. (Optional) If you set a password during generation, also add:
   - Secret name: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
4. The `release.yml` workflow (M10.2) references these secrets.

## Rotating

If the private key is ever compromised:
1. Generate a new keypair: `pnpm tauri signer generate -p "<strong-password>"`
2. Replace `pubkey` in `tauri.conf.json` — this BREAKS auto-update for existing
   installs. They will need a manual reinstall.
3. Update the GitHub Actions secret.

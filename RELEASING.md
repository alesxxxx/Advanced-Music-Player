# Releasing AMP

The `Release` workflow (`.github/workflows/release.yml`) builds the Windows installer and, on a
version tag, drafts a GitHub release with the installer attached. You review the draft and hit
publish — nothing goes public automatically.

## What the workflow does

- **On a `vX.Y.Z` tag push:** builds the installer and creates a **draft** release for that tag
  with the `.exe` attached and auto-generated notes.
- **On a manual run** (Actions → Release → *Run workflow*): builds the installer and uploads it as
  a workflow **artifact** only — no release. Use this to test a build without cutting a release.

It runs on `windows-latest` and produces the NSIS installer (`AMP Setup X.Y.Z.exe`). macOS and
Linux aren't wired up yet (macOS only builds to an app directory; castLabs Linux has no VMP).

## Secrets

Set these under **Settings → Secrets and variables → Actions**. All are optional, but they change
what the build can do.

| Secret | Purpose | If omitted |
| --- | --- | --- |
| `EVS_ACCOUNT_NAME` | castLabs EVS account — its presence turns VMP signing **on**. | Build is **unsigned**: everything works except DRM-protected SoundCloud tracks. |
| `EVS_PASSWD` | castLabs EVS password, for the non-interactive `reauth`. | — |
| `SPOTIFY_CLIENT_ID` | Bakes your Spotify OAuth client ID into the installer. | Users enter their own in-app. |
| `SOUNDCLOUD_CLIENT_ID` | Bakes your SoundCloud client ID in. | Users enter their own in-app. |
| `SOUNDCLOUD_CLIENT_SECRET` | Bakes your SoundCloud client secret in. | Users enter their own in-app. |
| `DISCORD_CLIENT_ID` | Bakes your Discord app ID (Rich Presence) in. | Rich Presence still works if a default ID is compiled in; otherwise off. |

`GITHUB_TOKEN` is provided automatically — the workflow grants it `contents: write` to create the
release.

> **Confirm the EVS auth before relying on signed CI builds.** The signing step authenticates with
> `python -m castlabs_evs.account reauth` using `EVS_ACCOUNT_NAME` / `EVS_PASSWD`. Check those env var
> names against the `castlabs-evs` version you use locally; if they differ, adjust the
> *Authenticate castLabs EVS* step. EVS **signup** is interactive (email verification) and must be
> done once on your own machine — see `apps/desktop/DRM-SIGNING.md`.

## Cut a release

1. Bump the version in **both** `apps/desktop/package.json` and the root `package.json` (keep them in
   sync — the installer filename comes from the desktop package version, and the workflow fails fast
   if the tag doesn't match it).
2. Commit the bump.
3. Tag and push:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
4. Watch the **Release** workflow under the Actions tab.
5. When it finishes, open **Releases**, review the draft (notes + attached `AMP Setup 0.1.0.exe`),
   and **Publish**.

## Signed vs unsigned, in one line

If `EVS_ACCOUNT_NAME` is set, the build is VMP-signed and plays DRM-protected SoundCloud tracks. If
not, it's a normal working installer that just can't play those specific tracks — fine for a first
public download, and you can always cut a signed build later once EVS is wired up.

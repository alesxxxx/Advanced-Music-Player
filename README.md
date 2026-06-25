# AMP — Advanced Music Player

Search Spotify and SoundCloud together, build playlists that mix both, and play it all from one queue. It's a local Electron app — your sessions and listening history stay on your machine.

> Personal project, not a product. It automates what your own browser already does (sign in, read your likes, play what you're entitled to). Staying within Spotify's and SoundCloud's terms is on you; don't redistribute builds.

## Features

- Unified search across both services (SoundCloud works without signing in)
- One library and playlists that freely mix Spotify and SoundCloud tracks
- Like/save on both providers, everywhere — player bar, lists, search, playlists
- Song-seeded radio and daily mixes, scored by tempo / genre / vibe
- Artist and album pages, mood + genre filters, on-device listening stats
- SoundCloud MP3 downloads, optional Discord Rich Presence
- Windows audio-reactive gradient (beat-synced)

No crossfade — the Spotify SDK can't do it honestly, so it's left out.

## Run it

```bash
corepack pnpm install
corepack pnpm dev
```

Bring your own API credentials: a Spotify client ID (with redirect URI `http://127.0.0.1:8000/spotify/callback`), and optionally a SoundCloud client id/secret. Set them as env vars (`SPOTIFY_CLIENT_ID`, …) or in Settings.

## Build a packaged app

```bash
corepack pnpm --filter @amp/desktop dist
```

Builds the Windows installer. Encrypted SoundCloud tracks only play from a **packaged, VMP-signed** build, never from `pnpm dev` — see [`apps/desktop/DRM-SIGNING.md`](apps/desktop/DRM-SIGNING.md). Cutting a release via CI is documented in [`RELEASING.md`](RELEASING.md).

## Notes

- Spotify playback needs Premium (library import doesn't).
- SoundCloud signs in through your own browser — no API key needed to search or play.

## Layout

- `apps/desktop` — the Electron app (`electron/` main process, `src/` React renderer)
- `packages/core` — shared models and the cross-provider queue engine

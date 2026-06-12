# AMP — Advanced Music Player

One desktop app for Spotify and SoundCloud — search both, build mixed playlists, and play everything in a single queue. Local-first Electron app; your sessions stay on your device.

## Run

```bash
corepack pnpm install
corepack pnpm dev
```

## Build

```bash
corepack pnpm --filter @amp/desktop dist   # packaged installer
```

## Notes

- Spotify playback needs a Premium account (library import works without it).
- SoundCloud signs in through your own browser (no API key needed).
- DRM-protected tracks only play from a packaged build, not `pnpm dev`.
</content>

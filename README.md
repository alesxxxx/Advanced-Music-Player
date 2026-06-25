# AMP — Advanced Music Player

A desktop app that puts Spotify and SoundCloud behind one search box, one library, and one queue. Search both at once, drop tracks from either service into the same playlist, and play through it without thinking about which platform a song came from. Everything runs locally in an Electron app — your sessions and listening history stay on your machine.

The repo is named **MuSync**; the app ships as **AMP**. Same thing.

> This is a personal project, not a product. It automates things your own browser already does (signing in, reading your likes, playing the audio you're entitled to) and wires two music services into a single UI. If you run it, you're the one responsible for staying inside Spotify's and SoundCloud's terms of service. Don't redistribute builds, and don't expect support.

---

## What it actually does

**One search, two services.** Type a query and AMP hits Spotify and SoundCloud in parallel, plus your already-imported library, and merges the results. You can scope it to one provider or search both. SoundCloud search works with no sign-in at all (it scrapes the same public `client_id` the website uses); Spotify search uses an anonymous token when you're not connected.

**A library that mixes sources.** Connect either account and AMP imports your Liked Songs / Likes and playlists. Build local playlists that freely mix Spotify and SoundCloud tracks — the queue engine handles handing playback off between the two as the playlist advances.

**Likes that write back.** The heart button works for both providers and is wired everywhere a track shows up: the player bar, library lists, artist/album/mix pages, search results, and playlist views. Liking a Spotify track saves it to your real Liked Songs (`PUT /me/tracks`); liking on SoundCloud does the same against your account.

**Radio and daily mixes.** Seed a station from any song and AMP builds a ~50-track queue: it finds a SoundCloud "twin" for the seed, walks two hops of related tracks, pulls in Spotify neighbours, then scores every candidate on vibe distance (BPM + loudness from Deezer), genre, and language, and orders them so you don't get the same artist twice in a row. The home page also generates six artist-anchored daily mixes, rebuilt once per calendar day so they're stable while you use them.

**Browsing.** Click into an artist or album. For Spotify you get top tracks, albums, genres, and follower counts; for SoundCloud you get the user's uploads and playlists.

**Mood and genre filtering.** A background pass enriches your library with tempo and loudness from Deezer and normalizes genre tags (SoundCloud tags and Spotify artist genres collapse into ~30 sane buckets like Hip Hop, House, Drum & Bass, K-Pop, Afrobeats). The library then filters by tempo bucket (Chill / Mellow / Upbeat / Energetic / Fast) and genre chip.

**SoundCloud downloads.** Free, downloadable SoundCloud tracks can be saved as MP3 to `Music/AMP/`.

**On-device stats.** Plays are recorded locally and never leave the machine. The Stats page shows top artists/tracks and listening over time.

**Discord Rich Presence.** Off by default. Turn it on and your now-playing shows up in Discord — title, artist, artwork, elapsed timer. It talks to the Discord client directly over its local IPC pipe, so there's no extra dependency, and if Discord isn't running it just stays quiet.

**A UI that reacts to the music.** Album art drives the accent color, and on Windows there's an audio-reactive mode: AMP taps the system audio loopback, runs spectral-flux beat detection on the bass band, and pulses a GPU-composited gradient layer in time with the kick. It only writes a couple of CSS variables per frame, so there's no per-frame layout or paint cost.

Per-provider volume trims are in there too (SoundCloud defaults to 0.3 against Spotify's 1.0 so the two roughly match in loudness), along with shuffle that reshuffles only the not-yet-played tail mid-playback.

What's **not** here: there's no crossfade. The Spotify Web Playback SDK doesn't give you the dual-stream control real crossfade needs, so it was left out rather than faked.

---

## How it's put together

It's a pnpm monorepo with two packages:

- **`packages/core`** (`@amp/core`) — the engine-agnostic heart. Pure TypeScript, no Electron, no React.
- **`apps/desktop`** (`@amp/desktop`) — the Electron app: a React/Tailwind renderer plus the main process that does all the privileged work.

### The core

`@amp/core` defines the shared vocabulary — `UnifiedTrack`, `ProviderConnection`, `UnifiedPlaylist`, `TrackCollection` — so the rest of the app never has to special-case "is this Spotify or SoundCloud" at the data level. Its real job is the **`QueueEngine`**: it owns one `PlaybackState`, registers a `PlaybackAdapter` per provider, and orchestrates handoff between them.

Each adapter implements a small contract (`search`, `getCollections`, `play`, `pause`, `seek`, `setVolume`, `teardown`, and an optional `preload`) and emits state snapshots back. The engine enforces that only one adapter is making sound at a time: when you play a track, it tears down every *other* adapter first, and a generation counter throws away events from a play you've already moved past, which is what keeps two providers from overlapping audio during a fast skip. It also handles queue reordering and removal without interrupting the current track, auto-skips anything unplayable, and composes master × per-provider volume in one place.

### Providers and playback

**Spotify** runs through the Web Playback SDK — AMP registers itself as a Spotify Connect device called "AMP" and drives it with `PUT /me/player/play`. Playback needs **Premium** (the SDK refuses anything else). Search, library, and likes all go through your OAuth token, with automatic refresh on a 401. There's also a reverse-engineered "partner gateway" path (the same GraphQL Pathfinder API the web player uses, with anonymous TOTP-minted tokens) that the main process can use for search and collections when you're not signed in — but actual in-app playback always needs OAuth + Premium.

**SoundCloud** is the more involved one. Search and public profile browsing need no account (scraped `client_id`). Playback resolves an HLS stream and plays it through a hidden media element; major-label tracks come back Widevine-encrypted, and when the native EME path can't get a license, AMP falls back to injecting SoundCloud's own player widget in a hidden, off-screen iframe and steering that. Signing in is optional and only adds your likes, playlists, and write access.

**Deezer** never plays anything. It's a metadata side-channel: AMP matches your tracks to Deezer by ISRC or title/artist and pulls BPM and loudness, which is what powers the tempo buckets and the station vibe-scorer. Matches are cached forever since they don't change.

### The gateway

The renderer doesn't make these provider calls directly — CORS and auth context make that miserable. Instead there's a **main-process gateway** that acts as an HTTP proxy. Requests go over IPC, the gateway makes them with a `StealthClient` (Electron's `net.request` dressed up with browser-like headers), and responses are cached to disk. This is also where the SoundCloud and Deezer logic lives, since it needs cookies and headers the renderer can't safely touch.

### DRM, and why you need a packaged build

This is the part that trips people up, so it's worth being precise.

AMP uses castLabs' Electron fork (`electron-releases#v41.1.1+wvcus`) because it ships a built-in Widevine CDM — that's how encrypted SoundCloud tracks decrypt at all. But that fork ships with a *development* VMP signature by default, and SoundCloud's license server (KeyOS) rejects development-signed clients with a `403` on the license request. So:

- `pnpm dev` and `electron .` run unsigned. Encrypted tracks **will not play** there — not a bug, just the signature.
- A packaged build (`pnpm dist`) runs the castLabs **EVS** signing tool in electron-builder's `afterPack` hook, which stamps the app with a *production* VMP signature. Those builds play encrypted tracks.

The VMP signature is a certificate proving the client is a genuine, content-secure build — nothing is being cracked. The audio is still only ever decrypted inside the Widevine CDM. `DRM-SIGNING.md` is the full runbook if you want the details, including how to register an EVS account.

The fallback chain (`src/lib/drm/DrmFallbackChain.ts`) tries the cheapest viable path first and remembers what worked per track: progressive MP3 → plain HLS → manual Widevine EME → SoundCloud widget. If a track succeeded via the widget last time, it'll skip straight there next time instead of eating the slow native-EME failure again.

(There's a `SoundCloudAdInjector` in the tree, but it's a Phase-1 scaffold — it returns nothing and never blocks playback. Don't read it as a feature.)

### SoundCloud, DataDome, and your browser cookies

SoundCloud sits behind DataDome, which fingerprints the browser making each request. A like written from Electron's Chromium looks like a *different* browser than the one DataDome already cleared, so it gets challenged. AMP works around this instead of fighting it: it can borrow the session from a browser you've actually logged into.

That means reading browser cookies, which is its own adventure per platform:

- **Chrome / Edge / Brave** — decrypts the cookie DB directly (DPAPI on Windows, Keychain on macOS). When Windows App-Bound Encryption (v20) blocks that, AMP copies the cookie DB to a throwaway profile, relaunches the browser headless with remote debugging, and reads the cookie back out over CDP — letting the browser decrypt its own cookies. You have to close the browser first, since the DB is locked while it's open.
- **Firefox** — cookies aren't encrypted; it reads `cookies.sqlite` straight from the profile.
- **Safari** — parses the binary `Cookies.binarycookies` format, which needs Full Disk Access on macOS.

For actually *writing* a like, AMP spawns a headful (but off-screen) browser carrying your `oauth_token`, lets DataDome's JS settle, and runs the like as an in-page fetch — because a headless write gets fingerprinted as automation and bounced. If it still hits a captcha, it can surface the DataDome challenge as an overlay for you to solve once, after which writes go through.

Yes, this is a genuinely absurd amount of machinery to press the like button. SoundCloud left the easy door locked.

### The native glue

The Electron main process exposes everything to the renderer through a single `window.spotCloud` bridge (a context-isolated preload over `contextBridge`). Beyond the gateway and OAuth, it handles:

- **OAuth** — Spotify over a PKCE loopback (`http://127.0.0.1:8000/spotify/callback`); SoundCloud over a custom `musync://` / `amp://` protocol callback. Tokens are persisted encrypted via Electron's `safeStorage`.
- **Window chrome** — frameless custom title bar on Windows/Linux, native hidden-inset traffic lights on macOS, with minimize/maximize/close and a compact mode driven over IPC.
- **System tray** — closing to tray instead of quitting, with a "still running" nudge the first time.
- **Discord presence** — the direct-IPC client described above.

---

## Running it

### Prerequisites

- A recent Node (20+) with **Corepack** enabled. The repo pins `pnpm@10.11.0` and every script goes through `corepack pnpm`, so you don't install pnpm globally.
- For packaged builds that play encrypted tracks: **Python** plus a castLabs EVS account (see `DRM-SIGNING.md`).
- Primary target is **Windows**. macOS builds to an app directory; Linux isn't wired up for packaging or DRM (no VMP on castLabs Linux).

### Credentials

The repo doesn't ship API keys — bring your own:

- **Spotify** — register an app in the Spotify developer dashboard, add `http://127.0.0.1:8000/spotify/callback` as a redirect URI, and supply its client ID via `SPOTIFY_CLIENT_ID` or the in-app config editor.
- **SoundCloud** — search and playback need nothing; sign-in is browser-based. If you want the API-token OAuth path, set `SOUNDCLOUD_CLIENT_ID` / `SOUNDCLOUD_CLIENT_SECRET`.

The in-app editor (Settings → desktop config) is gated behind `VITE_ENABLE_SELF_HOST_SETUP` if you'd rather not use environment variables.

### Develop

```bash
corepack pnpm install
corepack pnpm dev
```

Vite serves the renderer with hot reload and bundles the Electron main/preload. Everything works here *except* encrypted-track playback (no VMP signature). To run the dev bundle through Electron itself: `corepack pnpm smoke`.

### Build a real, signed app

```bash
corepack pnpm --filter @amp/desktop dist
```

This type-checks, builds the renderer and Electron bundles, then runs electron-builder. The `afterPack` hook calls EVS to embed the production VMP signature and fails loudly if it can't — so a successful `dist` is a build that can actually play encrypted SoundCloud tracks. On Windows you get an NSIS installer; on macOS, an app bundle directory.

One-time EVS setup (a human has to do this because of email verification):

```bash
corepack pnpm --filter @amp/desktop evs:signup   # register, verify via email
corepack pnpm --filter @amp/desktop evs:reauth    # refresh an expired session
```

On Windows you can skip remembering any of this and just use the launcher in `bin/`:

```bat
bin\amp.cmd            :: build if needed, then launch
bin\amp.cmd --rebuild  :: force a clean rebuild
bin\rebuild.cmd        :: same as --rebuild
```

It checks for a complete packaged build (it looks for `AMP.exe` and `icudtl.dat`), rebuilds via `pnpm dist` if anything's missing, and launches. `bin/amp.sh` does the equivalent on macOS.

---

## Project layout

```
.
├── apps/
│   └── desktop/
│       ├── electron/          # main process
│       │   ├── main.ts        # windows, IPC, OAuth, sessions
│       │   ├── preload.ts     # the window.spotCloud bridge
│       │   ├── gateway/       # main-process HTTP proxy + provider logic
│       │   ├── drm/           # node-side Widevine session
│       │   ├── *Cookies.ts    # Chrome/Edge/Firefox/Safari cookie readers
│       │   └── discordPresence.ts
│       ├── src/               # React renderer
│       │   ├── App.tsx        # pages, player bar, queue UI
│       │   ├── state/         # the Zustand store
│       │   ├── lib/
│       │   │   ├── providers/ # Spotify + SoundCloud playback adapters
│       │   │   ├── drm/       # Widevine engine, fallback chain, cert pool
│       │   │   ├── mixes/     # daily-mix + station composition
│       │   │   ├── audioReactor.ts
│       │   │   └── trackFeatures.ts / genreNormalize.ts
│       │   └── styles/
│       ├── scripts/           # build, VMP signing, verification
│       └── DRM-SIGNING.md     # the VMP/EVS runbook
├── packages/
│   └── core/                  # @amp/core: models, queue engine, adapter contract
└── bin/                       # amp.cmd / amp.sh launchers
```

## Scripts

Run from the root (they filter to `@amp/desktop`) or inside `apps/desktop`:

| Script | What it does |
| --- | --- |
| `dev` | Vite dev server (no VMP — encrypted tracks won't play) |
| `build` | Type-check + production bundle (renderer + Electron), unsigned |
| `dist` | `build` + electron-builder + EVS VMP signing → installer |
| `typecheck` | `tsc --noEmit` |
| `smoke` | Run the dev bundle through Electron |
| `evs:signup` / `evs:reauth` | Register / refresh the castLabs signing account |
| `verify:vmp` | Check a packaged build for the `.sig` signature files |

## Rough edges

- **No crossfade** — the Spotify SDK can't support it honestly, so it's absent rather than fake.
- **Encrypted playback is packaged-build-only**, by design (see DRM section).
- **Windows-first.** macOS works but is less exercised; Linux is effectively dev-only.
- **The SoundCloud like path is heavy** — it may briefly spin up an off-screen browser, and a first like after a while can prompt a one-time captcha.

## A note on DRM and terms

Nothing here breaks DRM. Encrypted audio is only ever decrypted inside Google's Widevine CDM, exactly as it is in your browser; the VMP signature just proves the app is a genuine content-secure client. AMP automates sign-in, library reads, and playback that you're already entitled to as a logged-in user. Whether running it is allowed under Spotify's and SoundCloud's terms is on you — treat it as a personal tool, keep builds to yourself, and don't use it to redistribute anyone's audio.

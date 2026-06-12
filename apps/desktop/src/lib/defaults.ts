import { type ProviderConnection } from "@amp/core";

/**
 * Default, honest provider connection state. Both providers start disconnected.
 *
 * The messages are deliberately accurate:
 * - Spotify needs a connected Premium account before any full-track playback works.
 * - SoundCloud search + playback work WITHOUT signing in (public web client_id),
 *   so we never imply a login is required. Signing in only adds personal likes/playlists.
 */
export function createDefaultConnections(): Record<"spotify" | "soundcloud", ProviderConnection> {
  return {
    spotify: {
      provider: "spotify",
      status: "disconnected",
      issue: "Connect your Spotify Premium account to play full tracks and load your library.",
      storageMode: "none"
    },
    soundcloud: {
      provider: "soundcloud",
      status: "disconnected",
      issue:
        "Search and play public SoundCloud tracks without signing in. Signing in is optional and only adds your personal likes and playlists.",
      storageMode: "none"
    }
  };
}

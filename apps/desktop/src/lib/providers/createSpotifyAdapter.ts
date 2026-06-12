import type { SpotifyAdapterOptions, SpotifyBaseAdapter } from "./spotifyBaseAdapter";
import { SpotifyWebAdapter } from "./spotifyWebAdapter";

export function createSpotifyAdapter(options: SpotifyAdapterOptions): SpotifyBaseAdapter {
  return new SpotifyWebAdapter(options);
}

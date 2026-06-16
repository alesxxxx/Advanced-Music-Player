import type { UnifiedTrack } from "@amp/core";
import { gatewayRequest } from "./desktopBridge";
import { normalizeGenres } from "./genreNormalize";
import { crossProviderKey, primaryArtist } from "./mixes/composition";

/**
 * Per-track audio-feature enrichment (renderer side).
 *
 * Tempo + loudness come from Deezer (the only obtainable source — Spotify removed /audio-features
 * and SoundCloud never had BPM). Genre comes provider-native: SoundCloud's per-track tag, or a
 * Spotify artist's genres. The resolved record is cached forever in localStorage keyed by
 * `crossProviderKey`, so a track is probed once across both providers and the same data powers both
 * the Library mood/genre chips and the radio scorer's vibe + genre signals.
 */

export type TempoBucket = "chill" | "mellow" | "upbeat" | "energetic" | "fast";

export interface TrackFeatures {
  /** crossProviderKey(track) */
  key: string;
  bpm: number | null;
  loudness: number | null;
  /** null = unknown (Deezer had no BPM for this track). */
  tempoBucket: TempoBucket | null;
  /** Normalized top-level genres (may be empty). */
  genres: string[];
  /** "ready" = has usable mood/genre data; "unmatched" = probed but nothing found (still terminal). */
  status: "ready" | "unmatched";
  fetchedAt: number;
}

export type TrackFeatureMap = Record<string, TrackFeatures>;

export const TEMPO_BUCKET_ORDER: TempoBucket[] = ["chill", "mellow", "upbeat", "energetic", "fast"];

export const TEMPO_BUCKET_LABELS: Record<TempoBucket, string> = {
  chill: "Chill",
  mellow: "Mellow",
  upbeat: "Upbeat",
  energetic: "Energetic",
  fast: "Fast"
};

/** Map a BPM to a coarse tempo/energy bucket. `null` BPM → null (Unknown). */
export function tempoBucketForBpm(bpm: number | null): TempoBucket | null {
  if (bpm == null || bpm <= 0) {
    return null;
  }
  if (bpm < 90) {
    return "chill";
  }
  if (bpm < 110) {
    return "mellow";
  }
  if (bpm < 128) {
    return "upbeat";
  }
  if (bpm < 150) {
    return "energetic";
  }
  return "fast";
}

interface DeezerFeatureData {
  bpm: number | null;
  loudness: number | null;
  matched: boolean;
}

export interface DeezerFetchResult {
  /** false = transient failure (e.g. Deezer quota) — caller should retry later, not mark terminal. */
  ok: boolean;
  bpm: number | null;
  loudness: number | null;
  matched: boolean;
}

/** Fetch tempo/loudness for one track via the Deezer gateway. */
export async function fetchDeezerFeatures(track: UnifiedTrack): Promise<DeezerFetchResult> {
  const response = await gatewayRequest<DeezerFeatureData>({
    provider: "deezer",
    operation: "getAudioFeatures",
    variables: {
      title: track.title,
      artist: primaryArtist(track),
      durationMs: track.durationMs
    }
  });
  if (response.ok && response.data) {
    return {
      ok: true,
      bpm: response.data.bpm,
      loudness: response.data.loudness,
      matched: response.data.matched
    };
  }
  return { ok: false, bpm: null, loudness: null, matched: false };
}

/** Resolve normalized top-level genres for a track from its SoundCloud tag or Spotify artist genres. */
export function resolveTrackGenres(
  track: UnifiedTrack,
  spotifyArtistGenres?: Map<string, string[]>
): string[] {
  if (track.provider === "soundcloud") {
    return normalizeGenres([track.genre]);
  }
  const artistId = track.creatorIds?.find(Boolean);
  const raw = artistId ? spotifyArtistGenres?.get(artistId) ?? [] : [];
  return normalizeGenres(raw);
}

/** Assemble a terminal TrackFeatures record from a Deezer result + resolved genres. */
export function makeTrackFeatures(
  track: UnifiedTrack,
  deezer: DeezerFetchResult,
  genres: string[],
  at: number
): TrackFeatures {
  return {
    key: crossProviderKey(track),
    bpm: deezer.bpm,
    loudness: deezer.loudness,
    tempoBucket: tempoBucketForBpm(deezer.bpm),
    genres,
    status: deezer.matched || genres.length > 0 ? "ready" : "unmatched",
    fetchedAt: at
  };
}

/** The feature record for a track, if it has been enriched. */
export function featuresFor(
  track: UnifiedTrack,
  map: TrackFeatureMap
): TrackFeatures | undefined {
  return map[crossProviderKey(track)];
}

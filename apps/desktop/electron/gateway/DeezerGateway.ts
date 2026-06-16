import { CacheStore } from "./CacheStore";
import { StealthClient } from "./StealthClient";
import type { GatewayResponse } from "./types";

/**
 * Deezer public API client for per-track audio features (tempo + loudness).
 *
 * Spotify removed public access to its /audio-features endpoint, and SoundCloud never exposed
 * BPM — so Deezer's free, no-auth catalogue is the only obtainable source of real tempo data.
 * `GET /track/{id}` returns `bpm` (float) and `gain` (loudness, dB). The search endpoint does NOT
 * carry those fields, so a match always costs two calls: search → detail.
 *
 * Results are cached for a long time (features are immutable per track) and misses are cached too,
 * so a library is only ever probed once. Quota errors are deliberately NOT cached — the renderer's
 * throttled enrichment retries them on a later pass.
 */

const DEEZER_API_BASE = "https://api.deezer.com";
// Audio features never change for a given recording — cache effectively forever.
const FEATURE_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface DeezerAudioFeatures {
  bpm: number | null;
  loudness: number | null;
  matched: boolean;
  deezerId?: number;
}

interface DeezerError {
  type?: string;
  message?: string;
  code?: number;
}

interface DeezerSearchTrack {
  id?: number;
  title?: string;
  duration?: number;
  artist?: { name?: string };
}

interface DeezerSearchResponse {
  data?: DeezerSearchTrack[];
  total?: number;
  error?: DeezerError;
}

interface DeezerTrackDetail {
  id?: number;
  title?: string;
  duration?: number;
  bpm?: number;
  gain?: number;
  isrc?: string;
  error?: DeezerError;
}

/** Strip credits/punctuation for tolerant title/artist matching. */
function normalizeForMatch(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ")
    .replace(/\b(?:feat\.?|ft\.?|featuring|with|prod\.?)\b.*$/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Deezer's "quota limit exceeded" comes back as HTTP 200 with an error envelope (code 4). */
function isQuotaError(error: DeezerError | undefined): boolean {
  return error?.code === 4 || /quota/i.test(error?.message ?? "");
}

export class DeezerGateway {
  private client: StealthClient;
  private cache: CacheStore;

  constructor(cache: CacheStore) {
    this.client = new StealthClient(undefined, { disableCookies: true });
    this.cache = cache;
  }

  async getAudioFeatures(input: {
    title?: string;
    artist?: string;
    durationMs?: number;
    isrc?: string;
  }): Promise<GatewayResponse<DeezerAudioFeatures>> {
    const title = (input.title ?? "").trim();
    const artist = (input.artist ?? "").trim();
    if (!title && !input.isrc) {
      return { ok: false, error: "Deezer lookup needs a title or ISRC.", source: "fallback" };
    }

    const cacheKey = `deezer:feat:${normalizeForMatch(artist)}::${normalizeForMatch(title)}`;
    const cached = this.cache.get<DeezerAudioFeatures>(cacheKey);
    if (cached) {
      return { ok: true, data: cached, source: "cache" };
    }

    try {
      let detail: DeezerTrackDetail | undefined;

      if (input.isrc) {
        detail = await this.fetchByIsrc(input.isrc);
      }
      if (!detail) {
        const match = await this.searchBestMatch(title, artist, input.durationMs);
        if (match?.quota) {
          // Rate limited — leave it unfetched so the renderer retries later (do NOT cache).
          return { ok: false, error: "Deezer quota exceeded.", source: "internal" };
        }
        if (match?.id) {
          detail = await this.fetchTrack(match.id);
        }
      }

      if (!detail || detail.error) {
        if (isQuotaError(detail?.error)) {
          return { ok: false, error: "Deezer quota exceeded.", source: "internal" };
        }
        const miss: DeezerAudioFeatures = { bpm: null, loudness: null, matched: false };
        this.cache.set(cacheKey, miss, FEATURE_CACHE_TTL_MS);
        return { ok: true, data: miss, source: "internal" };
      }

      const bpm = typeof detail.bpm === "number" && detail.bpm > 0 ? detail.bpm : null;
      const loudness = typeof detail.gain === "number" ? detail.gain : null;
      const data: DeezerAudioFeatures = {
        bpm,
        loudness,
        matched: true,
        deezerId: detail.id
      };
      this.cache.set(cacheKey, data, FEATURE_CACHE_TTL_MS);
      return { ok: true, data, source: "internal" };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Deezer lookup failed.",
        source: "internal"
      };
    }
  }

  private async fetchByIsrc(isrc: string): Promise<DeezerTrackDetail | undefined> {
    const json = await this.getJson<DeezerTrackDetail>(
      `${DEEZER_API_BASE}/track/isrc:${encodeURIComponent(isrc)}`
    );
    if (!json || json.error || !json.id) {
      return undefined;
    }
    return json;
  }

  private async fetchTrack(id: number): Promise<DeezerTrackDetail | undefined> {
    const json = await this.getJson<DeezerTrackDetail>(`${DEEZER_API_BASE}/track/${id}`);
    return json ?? undefined;
  }

  /** Find the best Deezer search hit for a title/artist; returns `{quota:true}` on rate limit. */
  private async searchBestMatch(
    title: string,
    artist: string,
    durationMs?: number
  ): Promise<{ id?: number; quota?: boolean } | undefined> {
    const query = artist
      ? `artist:"${artist}" track:"${title}"`
      : `track:"${title}"`;
    const url = `${DEEZER_API_BASE}/search?q=${encodeURIComponent(query)}&limit=8`;
    const json = await this.getJson<DeezerSearchResponse>(url);
    if (!json) {
      return undefined;
    }
    if (isQuotaError(json.error)) {
      return { quota: true };
    }
    const candidates = json.data ?? [];
    if (candidates.length === 0) {
      return undefined;
    }

    const nTitle = normalizeForMatch(title);
    const nArtist = normalizeForMatch(artist);
    const durSec = durationMs ? Math.round(durationMs / 1000) : undefined;

    let best: DeezerSearchTrack | undefined;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      const score = this.scoreCandidate(candidate, nTitle, nArtist, durSec);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    // Require a real title+artist match — a weak hit would poison the mood data.
    if (!best || bestScore < 3.5) {
      return undefined;
    }
    return { id: best.id };
  }

  private scoreCandidate(
    candidate: DeezerSearchTrack,
    nTitle: string,
    nArtist: string,
    durSec: number | undefined
  ): number {
    const candTitle = normalizeForMatch(candidate.title);
    const candArtist = normalizeForMatch(candidate.artist?.name);
    let score = 0;

    if (candTitle === nTitle) {
      score += 3;
    } else if (nTitle && (candTitle.includes(nTitle) || nTitle.includes(candTitle))) {
      score += 1.5;
    }
    if (candArtist === nArtist) {
      score += 2;
    } else if (nArtist && (candArtist.includes(nArtist) || nArtist.includes(candArtist))) {
      score += 1;
    }
    if (durSec && candidate.duration) {
      const delta = Math.abs(candidate.duration - durSec);
      if (delta <= 3) {
        score += 1;
      } else if (delta <= 8) {
        score += 0.5;
      } else if (delta > 25) {
        score -= 1;
      }
    }
    return score;
  }

  private async getJson<T>(url: string): Promise<T | undefined> {
    const response = await this.client.request(url, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
    if (response.status < 200 || response.status >= 300) {
      return undefined;
    }
    try {
      return JSON.parse(response.body) as T;
    } catch {
      return undefined;
    }
  }
}

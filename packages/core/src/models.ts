export type Provider = "spotify" | "soundcloud";
export type SoundCloudSubscriptionTier = "unknown" | "free" | "go" | "go-plus";
export type ProviderSessionSource = "local" | "memory";
export type ProviderStorageMode = "none" | "local-secure" | "memory-only";
export type ProviderCollectionKind = "saved-tracks" | "likes" | "playlist";
export type ProjectTrackSource =
  | "library-sync"
  | "search"
  | "playlist"
  | "playback"
  | "legacy-migration";

export type ProviderConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface UnifiedTrack {
  id: string;
  projectTrackId?: string;
  provider: Provider;
  providerTrackId: string;
  title: string;
  creators: string[];
  artworkUrl?: string;
  durationMs: number;
  explicit: boolean;
  externalUrl?: string;
  playable: boolean;
  album?: string;
  /** Provider-side album id (Spotify), when the source payload exposed it. Enables album pages
   *  without a name-based search round-trip; older cached tracks simply lack it. */
  albumId?: string;
  /** Provider-side artist ids aligned with `creators` (Spotify). Same backfill caveat as albumId. */
  creatorIds?: string[];
  /** Provider genre tag (SoundCloud exposes one per track). Soft signal for radio scoring. */
  genre?: string;
  providerUri?: string;
  description?: string;
  policy?: string;
  requiresGoPlus?: boolean;
}

export interface PlaylistEntry {
  id: string;
  playlistId: string;
  projectTrackId?: string;
  track: UnifiedTrack;
  order: number;
  addedAt: string;
  unresolvedReason?: string;
}

export interface ProjectTrack {
  id: string;
  ownerId: string;
  provider: Provider;
  providerTrackId: string;
  source: ProjectTrackSource;
  track: UnifiedTrack;
  createdAt: string;
  updatedAt: string;
}

export interface UnifiedPlaylist {
  id: string;
  ownerId: string;
  title: string;
  coverArtUrl?: string;
  entries: PlaylistEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ProviderConnection {
  provider: Provider;
  status: ProviderConnectionStatus;
  displayName?: string;
  connectedAt?: string;
  accessToken?: string;
  expiresAt?: string;
  requiresPremium?: boolean;
  /** SoundCloud subscription tier, detected from /me API or track heuristics. */
  subscriptionTier?: SoundCloudSubscriptionTier;
  issue?: string;
  metadata?: Record<string, string>;
  sessionSource?: ProviderSessionSource;
  storageMode?: ProviderStorageMode;
}

export interface PlaybackTransition {
  from?: Provider;
  to?: Provider;
  at: string;
}

export type ProviderVolumeMap = Record<Provider, number>;

export const DEFAULT_PROVIDER_VOLUMES: ProviderVolumeMap = {
  spotify: 1,
  soundcloud: 0.3
};

export interface PlaybackState {
  queue: UnifiedTrack[];
  currentIndex: number;
  activeProvider?: Provider;
  status: PlaybackStatus;
  positionMs: number;
  durationMs: number;
  volume: number;
  providerVolumes: ProviderVolumeMap;
  lastError?: string;
  canGoNext: boolean;
  canGoPrevious: boolean;
  lastTransition?: PlaybackTransition;
}

export interface ProviderCollection {
  id: string;
  provider: Provider;
  kind: ProviderCollectionKind;
  title: string;
  trackCount: number;
  artworkUrl?: string;
  externalUrl?: string;
  description?: string;
  ownerName?: string;
}

export interface TrackCollection {
  id: string;
  provider: Provider;
  kind: ProviderCollectionKind;
  title: string;
  items: UnifiedTrack[];
  artworkUrl?: string;
  externalUrl?: string;
  description?: string;
  ownerName?: string;
}

/** Clamp a playback volume into the valid 0-1 range. Shared by the queue engine, the provider
 *  adapters, and volume persistence so the bound (and any future volume semantics) lives in one
 *  place instead of being copied at every call site. */
export function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume));
}

export function createEmptyPlaybackState(): PlaybackState {
  return {
    queue: [],
    currentIndex: -1,
    status: "idle",
    positionMs: 0,
    durationMs: 0,
    volume: 0.8,
    providerVolumes: { ...DEFAULT_PROVIDER_VOLUMES },
    canGoNext: false,
    canGoPrevious: false
  };
}

export function withPlaybackFlags(state: PlaybackState): PlaybackState {
  const queueLength = state.queue.length;
  return {
    ...state,
    canGoPrevious: state.currentIndex > 0,
    canGoNext: state.currentIndex >= 0 && state.currentIndex < queueLength - 1
  };
}

export function createPlaylistEntry(
  playlistId: string,
  track: UnifiedTrack,
  order: number
): PlaylistEntry {
  return {
    id: crypto.randomUUID(),
    playlistId,
    projectTrackId: track.projectTrackId,
    track,
    order,
    addedAt: new Date().toISOString()
  };
}

export function reorderPlaylistEntries(entries: PlaylistEntry[]): PlaylistEntry[] {
  return entries.map((entry, index) => ({
    ...entry,
    order: index
  }));
}

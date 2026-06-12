import type {
  PlaybackStatus,
  Provider,
  ProviderCollection,
  TrackCollection,
  UnifiedTrack
} from "./models";

export interface PlaybackContext {
  queue: UnifiedTrack[];
  startAt: number;
  positionMs?: number;
}

export interface PlaybackAdapterSnapshot {
  provider: Provider;
  status: PlaybackStatus;
  positionMs: number;
  durationMs: number;
  volume: number;
  activeTrackId?: string;
  error?: string;
}

export interface PlaybackAdapterEvent {
  type: "state" | "ended" | "error";
  snapshot: PlaybackAdapterSnapshot;
}

export type PlaybackAdapterListener = (event: PlaybackAdapterEvent) => void;

export interface PlaybackAdapter {
  readonly provider: Provider;
  search(query: string): Promise<UnifiedTrack[]>;
  getCollections(): Promise<ProviderCollection[]>;
  getCollectionTracks(collectionId: string): Promise<TrackCollection>;
  getLibrary(): Promise<TrackCollection>;
  play(track: UnifiedTrack, context: PlaybackContext): Promise<void>;
  pause(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  preload?(track: UnifiedTrack): Promise<void>;
  teardown(): Promise<void>;
  subscribe(listener: PlaybackAdapterListener): () => void;
}

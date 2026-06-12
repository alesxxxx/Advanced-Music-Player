import clsx from "clsx";
import type { Provider, UnifiedTrack } from "@amp/core";

export function cn(...values: Array<string | false | null | undefined>) {
  return clsx(values);
}

export function formatDuration(durationMs = 0): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatClock(iso?: string): string {
  if (!iso) {
    return "Not connected";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(iso));
}

export function providerLabel(provider: Provider): string {
  return provider === "spotify" ? "Spotify" : "SoundCloud";
}

/**
 * Strips emoji and decorative emoji-like symbols (stars, music notes, dingbats) plus their
 * variation selectors / joiners from display text.
 */
export function stripEmoji(text: string): string {
  return text
    .replace(
      /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️‍]/gu,
      ""
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Emoji-free track title for display. Emoji-only titles become "Untitled" rather than leaking back. */
export function displayTitle(title: string): string {
  return stripEmoji(title) || "Untitled";
}

/** Emoji-free, comma-joined creators for display. */
export function displayCreators(creators: string[]): string {
  return creators
    .map((creator) => stripEmoji(creator))
    .filter(Boolean)
    .join(", ");
}

export function providerAccent(provider: Provider): string {
  return provider === "spotify" ? "spotify" : "soundcloud";
}

export function isTrackMatch(track: UnifiedTrack, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return [track.title, track.album, track.creators.join(" ")]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(normalized));
}

/*
 * ─── SOUNDCLOUD PLAYBACK — GROUND TRUTH (do NOT re-litigate; entitlement is not the issue) ───
 * NO track here requires Go+. Every liked track (incl. "DRM"/major-label ones like
 * Pop 1685274354) plays fine for THIS account in Chrome/Brave/Safari/Edge — no pay,
 * no Go+, never a problem. So a 403 in AMP is NEVER entitlement; it is a request-
 * context delta vs. a real browser (DataDome/anti-bot, cookies/session, CDM, headers).
 * Ads here are about RESPECTING the free-tier ad model, never about bypassing it.
 */
/**
 * SoundCloud Ad Injector Scaffold
 *
 * For free-tier SoundCloud users, AMP needs to respect the ad-supported
 * model. This module is a SCAFFOLD that:
 *  - Detects when a free-tier track is about to play
 *  - Optionally fetches and plays an advertisement before the track
 *  - Reports ad impressions for future programmatic inventory
 *  - Gracefully degrades if ads are unavailable (plays track directly)
 *
 * IMPORTANT: This is PHASE-1 infrastructure. The actual ad serving logic
 * (VAST parser, ad decisioning server, creative delivery) is deliberately
 * left as TODOs so we can iterate with the user's business requirements.
 *
 * The ad injector integrates with:
 *  - SubscriptionDetector: skips ads for Go+ users
 *  - DeviceIdentity: provides stable impression correlation IDs
 *  - QueueEngine: pauses the queue during ad playback, resumes after
 */

import type { DrmFallbackChain } from "./DrmFallbackChain";
import { globalSubscriptionDetector, type SubscriptionInfo } from "./SubscriptionDetector";
import { deviceIdentityManager } from "./DeviceIdentity";

export interface AdBreak {
  id: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /** The ad creative URL (MP4 / MP3). */
  creativeUrl?: string;
  /** VAST XML for future programmatic integration. */
  vastXml?: string;
  /** Campaign / house-ad identifier. */
  campaignId?: string;
}

export interface AdPlaybackState {
  status: "idle" | "loading" | "playing" | "completed" | "skipped" | "error";
  currentBreak?: AdBreak;
  positionMs: number;
  /** True once all breaks for this track have finished or been skipped. */
  allComplete: boolean;
}

export type AdInjectorListener = (state: AdPlaybackState) => void;

const AD_API_BASE = "https://api.soundcloud.com/ads"; // placeholder

export class SoundCloudAdInjector {
  private listeners = new Set<AdInjectorListener>();
  private state: AdPlaybackState = {
    status: "idle",
    positionMs: 0,
    allComplete: true
  };
  private audio = document.createElement("audio");

  subscribe(listener: AdInjectorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Check whether an ad break should play before the given track.
   * Returns a promise that resolves to true if ads were played,
   * false if the caller should proceed directly to the track.
   */
  async maybePlayAdsBeforeTrack(options: {
    trackTitle: string;
    trackDurationMs: number;
    onAdStateChange?: (state: AdPlaybackState) => void;
  }): Promise<boolean> {
    const subscription = globalSubscriptionDetector.getCurrent();

    // Go+ users never see ads.
    if (subscription.canPlayDrm) {
      return false;
    }

    // TODO: PHASE-2 — integrate with AMP ad-decisioning backend.
    // For the scaffold, we simulate a single 15-second house ad.
    const breaks = await this.fetchAdBreaks(options.trackTitle, options.trackDurationMs);
    if (breaks.length === 0) {
      return false;
    }

    for (const breakItem of breaks) {
      if (!breakItem.creativeUrl) {
        continue;
      }
      await this.playBreak(breakItem, options.onAdStateChange);
    }

    return true;
  }

  skipCurrentAd(): void {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.setState({ status: "skipped", allComplete: true });
  }

  private async fetchAdBreaks(
    _trackTitle: string,
    _trackDurationMs: number
  ): Promise<AdBreak[]> {
    // PHASE-1 SCAFFOLD: Return a synthetic house-ad so the pipeline is wired.
    // PHASE-2 TODO: Replace with real ad-decisioning API call.
    const identity = await deviceIdentityManager.ensureIdentity();

    // Report impression intent (diagnostic only in Phase 1).
    console.log(
      `[AdInjector] Fetching ads for device=${identity.deviceId}, tier=${globalSubscriptionDetector.getCurrent().tier}`
    );

    // Return empty so we don't block track playback during scaffold testing.
    // Uncomment below to simulate an ad:
    /*
    return [
      {
        id: "scaffold-ad-1",
        durationMs: 15_000,
        creativeUrl: "https://example.com/house-ad.mp3",
        campaignId: "amp-house-001"
      }
    ];
    */
    return [];
  }

  private async playBreak(
    breakItem: AdBreak,
    onAdStateChange?: (state: AdPlaybackState) => void
  ): Promise<void> {
    this.setState({ status: "loading", currentBreak: breakItem, allComplete: false });

    if (!breakItem.creativeUrl) {
      this.setState({ status: "completed", allComplete: true });
      return;
    }

    return new Promise((resolve) => {
      this.audio.src = breakItem.creativeUrl!;
      this.audio.load();

      const onEnded = () => {
        cleanup();
        this.setState({ status: "completed", allComplete: true });
        resolve();
      };

      const onError = () => {
        cleanup();
        this.setState({ status: "error", allComplete: true });
        resolve(); // don't block playback on ad error
      };

      const timer = window.setTimeout(() => {
        cleanup();
        this.setState({ status: "completed", allComplete: true });
        resolve();
      }, breakItem.durationMs + 3000);

      const cleanup = () => {
        this.audio.removeEventListener("ended", onEnded);
        this.audio.removeEventListener("error", onError);
        window.clearTimeout(timer);
      };

      this.audio.addEventListener("ended", onEnded);
      this.audio.addEventListener("error", onError);
      this.audio.play().catch(() => {
        cleanup();
        this.setState({ status: "error", allComplete: true });
        resolve();
      });
    });
  }

  private setState(partial: Partial<AdPlaybackState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // ignore
      }
    }
    // Also notify the one-shot callback used by the queue
    // (handled via a separate mechanism in the adapter)
  }
}

export const globalAdInjector = new SoundCloudAdInjector();

/*
 * ─── SOUNDCLOUD PLAYBACK — GROUND TRUTH (do NOT re-litigate; entitlement is not the issue) ───
 * NO track here requires Go+. Every liked track (incl. "DRM"/major-label ones like
 * Pop 1685274354) plays fine for THIS account in Chrome/Brave/Safari/Edge — no pay,
 * no Go+, never a problem. So a 403 in AMP is NEVER entitlement; it is a request-
 * context delta vs. a real browser (DataDome/anti-bot, cookies/session, CDM, headers).
 * Therefore `canPlayDrm` is ALWAYS true here — tier only influences whether we honour
 * the free-tier ad model. Never block a track from being attempted because of tier.
 */
/**
 * SoundCloud Subscription Detector
 *
 * Determines whether the signed-in user has SoundCloud Go+ (premium) or is on
 * the free/ad-supported tier. This drives:
 *  - Whether DRM tracks should even be attempted (Go+ only)
 *  - Whether to inject ads for free-tier playback
 *  - UI badges / messaging
 *
 * Detection sources:
 *  1. SoundCloud /me endpoint — the user object contains a `subscription` or
 *     `product` field on some API versions.
 *  2. Track-level `requiresGoPlus` flag — already computed in the gateway.
 *  3. Heuristic: if the user's likes contain ONLY DRM-only tracks, high
 *     probability they are Go+ (free users can't play those).
 *
 * The detector caches the result for the session and exposes reactive updates.
 */

export type SoundCloudSubscriptionTier = "unknown" | "free" | "go-plus" | "go";

export interface SubscriptionInfo {
  tier: SoundCloudSubscriptionTier;
  detectedAt: string;
  /** Reason / source for the detection. */
  source: "api" | "track-heuristic" | "default";
  /** If true, the user can play DRM-encrypted ( monetized ) tracks. */
  canPlayDrm: boolean;
  /** If true, ad injection should be considered for free-tier playback. */
  mayShowAds: boolean;
}

const SUBSCRIPTION_CACHE_KEY = "amp.sc.subscription.v1";

export class SubscriptionDetector {
  private cached: SubscriptionInfo | undefined;
  private listeners = new Set<(info: SubscriptionInfo) => void>();

  subscribe(listener: (info: SubscriptionInfo) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getCurrent(): SubscriptionInfo {
    return (
      this.cached ?? {
        tier: "unknown",
        detectedAt: new Date().toISOString(),
        source: "default",
        // Ground truth: no track needs Go+; DRM playback is always attempted regardless of tier.
        canPlayDrm: true,
        mayShowAds: true
      }
    );
  }

  /**
   * Update subscription info from the SoundCloud /me API response.
   * Call this from the main-process gateway after resolving the profile.
   */
  ingestApiResponse(userMeJson: Record<string, unknown>): void {
    const tier = this.parseTierFromUser(userMeJson);
    const info: SubscriptionInfo = {
      tier,
      detectedAt: new Date().toISOString(),
      source: "api",
      // Ground truth: these tracks play in a browser on this account regardless of tier.
      canPlayDrm: true,
      mayShowAds: tier === "free" || tier === "unknown"
    };
    this.setAndNotify(info);
  }

  /**
   * Heuristic detection based on track metadata when no API data is available.
   */
  ingestTrackHeuristic(requiresGoPlus: boolean): void {
    if (this.cached && this.cached.source === "api") {
      // API data is authoritative; don't override with heuristic.
      return;
    }
    const tier: SoundCloudSubscriptionTier = requiresGoPlus ? "go-plus" : "free";
    const info: SubscriptionInfo = {
      tier,
      detectedAt: new Date().toISOString(),
      source: "track-heuristic",
      // Ground truth: no track needs Go+; never gate DRM attempts on the heuristic tier.
      canPlayDrm: true,
      mayShowAds: tier === "free"
    };
    this.setAndNotify(info);
  }

  reset(): void {
    this.cached = undefined;
    try {
      globalThis.localStorage?.removeItem(SUBSCRIPTION_CACHE_KEY);
    } catch {
      // ignore
    }
  }

  private parseTierFromUser(user: Record<string, unknown>): SoundCloudSubscriptionTier {
    // SoundCloud's internal API shape varies; probe common fields.
    const product = (user.product as string | undefined)?.toLowerCase() ?? "";
    const subscription = (user.subscription as string | undefined)?.toLowerCase() ?? "";
    const hasGoPlus =
      product.includes("go+") ||
      product.includes("goplus") ||
      subscription.includes("go+") ||
      subscription.includes("goplus") ||
      (user.subscription_tier as string)?.toLowerCase().includes("plus");

    const hasGo =
      product.includes("go") ||
      subscription.includes("go") ||
      (user.subscription_tier as string)?.toLowerCase().includes("go");

    if (hasGoPlus) return "go-plus";
    if (hasGo) return "go";

    const isFree =
      product.includes("free") ||
      subscription.includes("free") ||
      user.product === null ||
      user.subscription === null;

    if (isFree) return "free";
    return "unknown";
  }

  private setAndNotify(info: SubscriptionInfo): void {
    this.cached = info;
    try {
      globalThis.localStorage?.setItem(SUBSCRIPTION_CACHE_KEY, JSON.stringify(info));
    } catch {
      // ignore
    }
    for (const listener of this.listeners) {
      try {
        listener(info);
      } catch {
        // ignore
      }
    }
  }
}

export const globalSubscriptionDetector = new SubscriptionDetector();

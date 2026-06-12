/**
 * AMP DRM Scaffold
 *
 * Central barrel for all DRM, subscription, ad-injection, and device-identity
 * modules. Import from here so the adapter doesn't need to know individual
 * file paths.
 */

export { deviceIdentityManager, type DeviceIdentity } from "./DeviceIdentity";
export { globalCertPool, CdmCertificatePool } from "./CdmCertificatePool";
export {
  WidevineDrmEngine,
  type DrmLicenseConfig,
  type DrmInitData,
  type DrmEngineEvent,
  type DrmEngineResult,
  type DrmEngineListener
} from "./WidevineDrmEngine";
export {
  DrmFallbackChain,
  type FallbackStage,
  type FallbackDiagnostics,
  type FallbackResult,
  type FallbackListener
} from "./DrmFallbackChain";
export {
  globalSubscriptionDetector,
  SubscriptionDetector,
  type SoundCloudSubscriptionTier,
  type SubscriptionInfo
} from "./SubscriptionDetector";
export {
  globalAdInjector,
  SoundCloudAdInjector,
  type AdBreak,
  type AdPlaybackState,
  type AdInjectorListener
} from "./SoundCloudAdInjector";

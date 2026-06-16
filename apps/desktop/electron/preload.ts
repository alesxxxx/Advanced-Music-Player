import { appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { contextBridge, ipcRenderer } from "electron";
const preloadLogPath = path.join(os.tmpdir(), "studio-relay-preload.log");

function logPreload(message: string) {
  try {
    appendFileSync(preloadLogPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // Never block renderer bootstrap on preload logging.
  }
}

contextBridge.exposeInMainWorld("spotCloud", {
  runtime: {
    getInfo: () => ipcRenderer.invoke("spot-cloud:get-runtime-info"),
    reload: () => ipcRenderer.invoke("spot-cloud:reload-runtime")
  },
  gateway: {
    request: (req: { provider: "spotify" | "soundcloud" | "deezer"; operation: string; variables?: Record<string, unknown> }) =>
      ipcRenderer.invoke("spot-cloud:gateway-request", req)
  },
  config: {
    get: () => ipcRenderer.invoke("spot-cloud:get-desktop-config"),
    save: (config: {
      spotifyClientId: string;
      soundCloudClientId: string;
      soundCloudClientSecret: string;
    }) => ipcRenderer.invoke("spot-cloud:save-desktop-config", config),
    openDirectory: () => ipcRenderer.invoke("spot-cloud:open-config-directory")
  },
  sessions: {
    list: () => ipcRenderer.invoke("spot-cloud:list-provider-sessions"),
    clear: (provider: "spotify" | "soundcloud") =>
      ipcRenderer.invoke("spot-cloud:clear-provider-session", provider),
    refresh: (request: { provider: "spotify" | "soundcloud" }) =>
      ipcRenderer.invoke("spot-cloud:refresh-provider-session", request)
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke("spot-cloud:open-external", url)
  },
  soundcloud: {
    getPublicClientId: () => ipcRenderer.invoke("spot-cloud:get-soundcloud-public-client-id"),
    webReload: () => ipcRenderer.invoke("spot-cloud:soundcloud-web-reload"),
    webHasSession: () => ipcRenderer.invoke("spot-cloud:soundcloud-web-has-session"),
    webSetTrackLiked: (request: { track: unknown; liked: boolean }) =>
      ipcRenderer.invoke("spot-cloud:soundcloud-web-set-track-liked", request),
    webSignOut: () => ipcRenderer.invoke("spot-cloud:soundcloud-web-signout"),
    systemBrowserSignIn: () => ipcRenderer.invoke("spot-cloud:soundcloud-system-browser-signin"),
    downloadTrack: (request: { track: unknown }) =>
      ipcRenderer.invoke("spot-cloud:download-soundcloud-track", request),
    inAppSignIn: () => ipcRenderer.invoke("spot-cloud:soundcloud-in-app-signin"),
    localListProfiles: () => ipcRenderer.invoke("spot-cloud:soundcloud-local-list-profiles"),
    localConnect: (request: { profileId: string }) =>
      ipcRenderer.invoke("spot-cloud:soundcloud-local-connect", request),
    localOpenSignin: (request: { profileId: string }) =>
      ipcRenderer.invoke("spot-cloud:soundcloud-local-open-signin", request),
    localCloseBrowser: (request: { profileId: string }) =>
      ipcRenderer.invoke("spot-cloud:soundcloud-local-close-browser", request),
    localSetTrackLiked: (request: { track: unknown; liked: boolean }) =>
      ipcRenderer.invoke("spot-cloud:soundcloud-local-set-track-liked", request)
  },
  spotify: {
    getAnonymousSession: () => ipcRenderer.invoke("spot-cloud:get-anonymous-spotify-session")
  },
  discord: {
    setPresence: (payload: unknown) => ipcRenderer.invoke("spot-cloud:set-discord-presence", payload),
    setEnabled: (enabled: boolean) =>
      ipcRenderer.invoke("spot-cloud:set-discord-presence-enabled", enabled)
  },
  artwork: {
    resolve: (request: { artworkUrl?: string; cacheKey?: string }) =>
      ipcRenderer.invoke("spot-cloud:resolve-artwork", request)
  },
  windowControls: {
    getState: () => ipcRenderer.invoke("spot-cloud:get-window-state"),
    finishStartup: () => ipcRenderer.invoke("spot-cloud:finish-startup-window"),
    minimize: () => ipcRenderer.invoke("spot-cloud:minimize-window"),
    toggleMaximize: () => ipcRenderer.invoke("spot-cloud:toggle-maximize-window"),
    setCompactMode: (compact: boolean) => ipcRenderer.invoke("spot-cloud:set-compact-mode", compact),
    close: () => ipcRenderer.invoke("spot-cloud:close-window"),
    openDevTools: () => ipcRenderer.invoke("spot-cloud:open-devtools")
  },
  oauth: {
    connect: (request: { provider: "spotify" | "soundcloud" }) =>
      ipcRenderer.invoke("spot-cloud:connect-provider", request),
    cancelConnect: (provider: "spotify" | "soundcloud") =>
      ipcRenderer.invoke("spot-cloud:cancel-connect-provider", provider)
  },
  drm: {
    widevineNodeLicense: (request: {
      psshBase64: string;
      licenseUrl: string;
      licenseAuthToken?: string;
      privateKeyPath: string;
      identifierBlobPath: string;
    }) => ipcRenderer.invoke("spot-cloud:widevine-node-license", request),
    getWidevineStatus: () => ipcRenderer.invoke("spot-cloud:get-widevine-status")
  }
});

logPreload("context bridge exposed");

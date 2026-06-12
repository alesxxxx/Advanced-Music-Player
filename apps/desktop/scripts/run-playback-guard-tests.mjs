import { fileURLToPath, pathToFileURL } from "node:url";

const guardsPath = fileURLToPath(new URL("../src/lib/providers/playbackGuards.ts", import.meta.url));
const guardsUrl = pathToFileURL(guardsPath).href;

const {
  getSoundCloudStreamReadyTimeoutMessage,
  isStartupWithoutProgress,
  resetSoundCloudWidgetEventBridge,
  WidgetPlaybackStartGate
} = await import(guardsUrl);

let failures = 0;
const assert = (condition, message) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
};

assert(
  getSoundCloudStreamReadyTimeoutMessage("hls").includes("manifest"),
  "HLS timeout message should identify manifest timeout"
);

assert(
  getSoundCloudStreamReadyTimeoutMessage("progressive").includes("playback"),
  "progressive timeout message should identify playback readiness timeout"
);

assert(
  !isStartupWithoutProgress({
    hasSeenProgress: false,
    positionMs: 0,
    msSinceStart: 11_000,
    startupGraceMs: 3_500,
    stallMs: 8_000
  }),
  "startup guard should wait through the grace plus stall window"
);

assert(
  isStartupWithoutProgress({
    hasSeenProgress: false,
    positionMs: 0,
    msSinceStart: 12_000,
    startupGraceMs: 3_500,
    stallMs: 8_000
  }),
  "startup guard should fail a paused-at-zero SDK state after the normal stall window"
);

assert(
  !isStartupWithoutProgress({
    hasSeenProgress: true,
    positionMs: 0,
    msSinceStart: 20_000,
    startupGraceMs: 3_500,
    stallMs: 8_000
  }),
  "startup guard should not reinterpret a finished track as a startup failure"
);

assert(
  !isStartupWithoutProgress({
    hasSeenProgress: false,
    positionMs: 0,
    msSinceStart: 20_000,
    startupGraceMs: 3_500,
    stallMs: 8_000,
    userPaused: true
  }),
  "startup guard should not skip a track the user paused before it advanced"
);

class FakeSoundCloudWidget {
  constructor() {
    this.listeners = new Map();
    this.unbinds = [];
  }

  bind(eventName, listener) {
    const listeners = this.listeners.get(eventName) ?? [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);
  }

  unbind(eventName) {
    this.unbinds.push(eventName);
    this.listeners.set(eventName, []);
  }

  emit(eventName, payload) {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener(payload);
    }
  }

  listenerCount(eventName) {
    return this.listeners.get(eventName)?.length ?? 0;
  }
}

const widgetEvents = {
  PLAY: "play",
  PAUSE: "pause",
  PLAY_PROGRESS: "playProgress",
  FINISH: "finish",
  ERROR: "error"
};

async function testSoundCloudWidgetBridgeReset() {
  const widget = new FakeSoundCloudWidget();
  const startGate = new WidgetPlaybackStartGate({
    timeoutMs: 5_000,
    timeoutMessage: "Widget test timed out."
  });
  let progressCalls = 0;
  let playbackStartResolutions = 0;

  const resetBridge = () =>
    resetSoundCloudWidgetEventBridge(widget, widgetEvents, {
      onPlay: () => undefined,
      onPause: () => undefined,
      onProgress: (payload) => {
        progressCalls += 1;
        if ((payload?.currentPosition ?? 0) > 0) {
          startGate.resolve();
        }
      },
      onFinish: () => undefined,
      onError: () => startGate.reject(new Error("Widget test error."))
    });

  resetBridge();
  resetBridge();

  for (const eventName of Object.values(widgetEvents)) {
    assert(
      widget.listenerCount(eventName) === 1,
      `widget bridge should leave one ${eventName} listener after repeated resets`
    );
  }

  const started = startGate.wait().then(() => {
    playbackStartResolutions += 1;
  });

  widget.emit(widgetEvents.PLAY_PROGRESS, { currentPosition: 10 });
  widget.emit(widgetEvents.PLAY_PROGRESS, { currentPosition: 20 });
  await started;
  await Promise.resolve();

  assert(progressCalls === 2, `single progress bridge should handle two emits, got ${progressCalls}`);
  assert(
    playbackStartResolutions === 1,
    `playback-start gate should resolve once, got ${playbackStartResolutions}`
  );
}

await testSoundCloudWidgetBridgeReset();

if (failures === 0) {
  console.log("PASS: playback guard tests completed.");
} else {
  console.error(`FAIL: ${failures} playback guard assertion(s) failed.`);
  process.exitCode = 1;
}

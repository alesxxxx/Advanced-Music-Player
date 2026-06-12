export function getSoundCloudStreamReadyTimeoutMessage(kind: "hls" | "progressive"): string {
  return kind === "hls"
    ? "SoundCloud HLS stream timed out before the manifest loaded."
    : "SoundCloud progressive stream timed out before playback was ready.";
}

export function isStartupWithoutProgress(input: {
  hasSeenProgress: boolean;
  positionMs: number;
  msSinceStart: number;
  startupGraceMs: number;
  stallMs: number;
  userPaused?: boolean;
}): boolean {
  return (
    !input.userPaused &&
    !input.hasSeenProgress &&
    input.positionMs <= 0 &&
    input.msSinceStart > input.startupGraceMs + input.stallMs
  );
}

export interface SoundCloudWidgetEventSource<Payload = unknown> {
  bind(eventName: string, listener: (payload?: Payload) => void): void;
  unbind(eventName: string): void;
}

export interface SoundCloudWidgetBridgeEvents {
  PLAY: string;
  PAUSE: string;
  PLAY_PROGRESS: string;
  FINISH: string;
  ERROR?: string;
}

export interface SoundCloudWidgetBridgeCallbacks<Payload = unknown> {
  onPlay(): void;
  onPause(): void;
  onProgress(payload?: Payload): void;
  onFinish(): void;
  onError?(): void;
}

export function resetSoundCloudWidgetEventBridge<Payload>(
  widget: SoundCloudWidgetEventSource<Payload>,
  events: SoundCloudWidgetBridgeEvents,
  callbacks: SoundCloudWidgetBridgeCallbacks<Payload>
): void {
  const eventNames = [
    events.PLAY,
    events.PAUSE,
    events.PLAY_PROGRESS,
    events.FINISH,
    events.ERROR
  ].filter((eventName): eventName is string => Boolean(eventName));

  for (const eventName of eventNames) {
    widget.unbind(eventName);
  }

  widget.bind(events.PLAY, callbacks.onPlay);
  widget.bind(events.PAUSE, callbacks.onPause);
  widget.bind(events.PLAY_PROGRESS, callbacks.onProgress);
  widget.bind(events.FINISH, callbacks.onFinish);
  if (events.ERROR && callbacks.onError) {
    widget.bind(events.ERROR, callbacks.onError);
  }
}

type WidgetPlaybackTimer = ReturnType<typeof globalThis.setTimeout>;

interface WidgetPlaybackStartGateOptions {
  timeoutMs: number;
  timeoutMessage: string;
}

export class WidgetPlaybackStartGate {
  private options: WidgetPlaybackStartGateOptions;
  private pending?: {
    timer: WidgetPlaybackTimer;
    resolve: () => void;
    reject: (error: Error) => void;
  };

  constructor(options: WidgetPlaybackStartGateOptions) {
    this.options = options;
  }

  wait(): Promise<void> {
    this.cancel(new Error("SoundCloud widget playback wait was replaced."));

    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        if (!this.pending) {
          return;
        }
        globalThis.clearTimeout(this.pending.timer);
        this.pending = undefined;
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const timer = globalThis.setTimeout(
        () => finish(new Error(this.options.timeoutMessage)),
        this.options.timeoutMs
      );

      this.pending = {
        timer,
        resolve: () => finish(),
        reject: finish
      };
    });
  }

  resolve(): void {
    this.pending?.resolve();
  }

  reject(error: Error): void {
    this.pending?.reject(error);
  }

  cancel(error: Error): void {
    this.reject(error);
  }
}

import { promises as fs } from "node:fs";
import path from "node:path";
import type { CacheEntry } from "./types";

export class CacheStore {
  private cacheDir: string;
  private memoryCache = new Map<string, CacheEntry>();
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(userDataPath: string) {
    this.cacheDir = path.join(userDataPath, "gateway-cache");
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    await this.hydrate();
  }

  get<T>(key: string): T | undefined {
    const entry = this.memoryCache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.memoryCache.delete(key);
      this.dirty = true;
      this.scheduleFlush();
      return undefined;
    }
    return entry.data as T;
  }

  set(key: string, data: unknown, ttlMs: number, etag?: string): void {
    const now = Date.now();
    this.memoryCache.set(key, {
      key,
      data,
      etag,
      expiresAt: now + ttlMs,
      createdAt: now
    });
    this.dirty = true;
    this.scheduleFlush();
  }

  invalidate(pattern?: RegExp): void {
    if (!pattern) {
      this.memoryCache.clear();
      this.dirty = true;
      this.scheduleFlush();
      return;
    }

    for (const key of this.memoryCache.keys()) {
      if (pattern.test(key)) {
        this.memoryCache.delete(key);
        this.dirty = true;
      }
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => {
      void this.flush();
    }, 2000);
  }

  private async flush(): Promise<void> {
    if (!this.dirty) {
      return;
    }

    try {
      const entries = Array.from(this.memoryCache.values());
      const payload = JSON.stringify(entries, null, 2);
      await fs.writeFile(path.join(this.cacheDir, "store.json"), payload, "utf8");
      this.dirty = false;
    } catch {
      // Cache flush failure is non-critical.
    }
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await fs.readFile(path.join(this.cacheDir, "store.json"), "utf8");
      const entries = JSON.parse(raw) as CacheEntry[];
      const now = Date.now();

      for (const entry of entries) {
        if (entry.expiresAt > now) {
          this.memoryCache.set(entry.key, entry);
        }
      }
    } catch {
      // Hydration failure is fine on first run.
    }
  }
}

// Reads cookies directly from a Firefox profile on disk. Firefox is not Chromium and stores
// cookie values UNENCRYPTED in `cookies.sqlite` (the `moz_cookies` table), so no key material,
// DPAPI, or Keychain access is involved on any platform — making it the most robust SoundCloud
// connect path on Windows, where Chrome/Edge cookies are sealed with App-Bound Encryption.
//
// The database can be in WAL mode while Firefox runs, so we read from a private copy (the DB plus
// any -wal/-shm sidecars). On Windows the caller closes Firefox first (the file is OS-locked while
// it runs); on macOS the copy succeeds even while Firefox is open.

import { copyFile, readFile, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";

import type { DecryptedCookie } from "./chromiumCookies.js";

export interface FirefoxProfile {
  /** Display name from profiles.ini (e.g. "default-release"), falling back to the folder name. */
  name: string;
  /** Absolute path to the profile directory (which contains `cookies.sqlite`). */
  directory: string;
  /** True if Firefox marks this as a default profile. */
  isDefault: boolean;
}

/** Absolute path to the Firefox user-profiles root, or undefined on unsupported platforms. */
export function getFirefoxRootDirectory(): string | undefined {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Mozilla", "Firefox");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Firefox");
  }
  if (process.platform === "linux") {
    return path.join(os.homedir(), ".mozilla", "firefox");
  }
  return undefined;
}

interface ProfileSectionDraft {
  name?: string;
  /** Whether `Path` is relative to the Firefox root. Absent in profiles.ini implies relative. */
  relative?: boolean;
  pathValue?: string;
  isDefault?: boolean;
}

/**
 * Parses `profiles.ini` into profiles with absolute directories. Returns [] when the file is
 * missing or unreadable. Only `[ProfileN]` sections describe profiles; `[General]`/`[InstallXX]`
 * sections are ignored.
 */
export async function listFirefoxProfiles(): Promise<FirefoxProfile[]> {
  const root = getFirefoxRootDirectory();
  if (!root) {
    return [];
  }
  let raw: string;
  try {
    raw = await readFile(path.join(root, "profiles.ini"), "utf8");
  } catch {
    return [];
  }

  const profiles: FirefoxProfile[] = [];
  let current: ProfileSectionDraft | undefined;
  const flush = () => {
    if (current?.pathValue) {
      const directory =
        current.relative === false ? path.normalize(current.pathValue) : path.join(root, current.pathValue);
      profiles.push({
        name: current.name?.trim() || path.basename(current.pathValue),
        directory,
        isDefault: Boolean(current.isDefault)
      });
    }
    current = undefined;
  };

  for (const line of raw.split(/\r?\n/)) {
    const section = line.match(/^\s*\[(.+?)\]\s*$/);
    if (section) {
      flush();
      current = /^Profile\d+$/i.test(section[1]) ? {} : undefined;
      continue;
    }
    if (!current) {
      continue;
    }
    const kv = line.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
    if (!kv) {
      continue;
    }
    const key = kv[1].toLowerCase();
    const value = kv[2];
    if (key === "name") {
      current.name = value;
    } else if (key === "isrelative") {
      current.relative = value.trim() === "1";
    } else if (key === "path") {
      current.pathValue = value;
    } else if (key === "default") {
      current.isDefault = value.trim() === "1";
    }
  }
  flush();
  return profiles;
}

/** Copies the cookies DB plus any WAL/SHM sidecars to a private temp file. */
async function copyDbToTemp(dbPath: string): Promise<string> {
  const tmpBase = path.join(os.tmpdir(), `amp-ff-cookies-${process.pid}-${Date.now().toString(36)}.sqlite`);
  await copyFile(dbPath, tmpBase);
  for (const ext of ["-wal", "-shm"]) {
    await copyFile(dbPath + ext, tmpBase + ext).catch(() => undefined);
  }
  return tmpBase;
}

async function removeTemp(tmpBase: string): Promise<void> {
  for (const ext of ["", "-wal", "-shm"]) {
    await rm(tmpBase + ext, { force: true }).catch(() => undefined);
  }
}

/**
 * Reads cookies whose host matches `hostLike` (a SQL LIKE pattern, e.g. "%soundcloud.com") from a
 * Firefox profile's `cookies.sqlite`. Values are returned verbatim — Firefox does not encrypt cookie
 * values. `hostKey` carries Firefox's `host` column (e.g. ".soundcloud.com").
 */
export async function readFirefoxCookies(cookieDbPath: string, hostLike: string): Promise<DecryptedCookie[]> {
  const tmpBase = await copyDbToTemp(cookieDbPath);
  try {
    const db = new DatabaseSync(tmpBase, { readOnly: true });
    try {
      const rows = db
        .prepare("SELECT name, value, host AS hostKey FROM moz_cookies WHERE host LIKE ?")
        .all(hostLike) as Array<{ name: string; value: string; hostKey: string }>;
      return rows.map((row) => ({ name: row.name, value: row.value, hostKey: row.hostKey }));
    } finally {
      db.close();
    }
  } finally {
    await removeTemp(tmpBase);
  }
}

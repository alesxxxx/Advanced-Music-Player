// Reads and decrypts cookies directly from a Chromium-family browser profile on disk
// (Chrome, Edge, Brave).
//
// Windows: the per-profile AES key is wrapped with DPAPI; cookie values are AES-256-GCM (v10/v11),
//          legacy whole-value DPAPI, or v20 App-Bound Encryption (not decryptable from outside).
// macOS:   the AES key is derived (PBKDF2-HMAC-SHA1, "saltysalt", 1003 rounds → 16 bytes) from the
//          browser's "Safe Storage" password kept in the login Keychain; cookie values are
//          AES-128-CBC (v10) with a 16-space IV. The first Keychain read shows a one-time OS
//          permission prompt for AMP.
//
// On Windows the browser must be fully closed (the Cookies DB is OS-locked while it runs). On macOS
// the DB is not exclusively locked, so a copy can be read even while the browser is open.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, readFile, rm } from "node:fs/promises";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

export interface DecryptedCookie {
  name: string;
  value: string;
  hostKey: string;
}

/** macOS Keychain coordinates for a browser's "Safe Storage" password. */
export interface MacKeychainRef {
  /** Keychain service, e.g. "Chrome Safe Storage". */
  service: string;
  /** Keychain account, e.g. "Chrome". */
  account: string;
}

export interface ReadCookiesOptions {
  /** Absolute path to the profile's `Network/Cookies` SQLite database. */
  cookieDbPath: string;
  /** Absolute path to the browser's `Local State` (holds the encrypted profile key on Windows). */
  localStatePath: string;
  /** SQL LIKE filter on `host_key`, e.g. "%soundcloud.com". */
  hostLike: string;
  /** Required on macOS: which Keychain "Safe Storage" entry holds this browser's key. */
  macKeychain?: MacKeychainRef;
}

export interface ReadCookiesResult {
  cookies: DecryptedCookie[];
  /** True if one or more matching cookies used App-Bound Encryption (v20) and were skipped. */
  appBoundBlocked: boolean;
}

/** Thrown when running on a platform without supported cookie decryption. */
export class UnsupportedPlatformError extends Error {}

/** Thrown when the macOS Keychain refuses to hand over the browser's Safe Storage key. */
export class KeychainAccessError extends Error {}

const DPAPI_PREFIX = Buffer.from("DPAPI", "latin1");
const aesKeyCache = new Map<string, Buffer>();

// macOS Chromium key derivation constants (stable across Chrome/Edge/Brave).
const MAC_SALT = "saltysalt";
const MAC_ITERATIONS = 1003;
const MAC_KEY_LENGTH = 16;
const MAC_IV = Buffer.alloc(16, " "); // 16 spaces

function assertSupportedPlatform(): void {
  if (process.platform !== "win32" && process.platform !== "darwin") {
    throw new UnsupportedPlatformError("Local cookie import is only supported on Windows and macOS.");
  }
}

/** Runs DPAPI CryptUnprotectData (CurrentUser scope) via PowerShell. No native dependency. */
async function dpapiUnprotect(data: Buffer): Promise<Buffer> {
  const ps =
    "$b=[Convert]::FromBase64String($env:SPOTCLOUD_DPAPI_IN); " +
    "Add-Type -AssemblyName System.Security; " +
    "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))";
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
    {
      env: { ...process.env, SPOTCLOUD_DPAPI_IN: data.toString("base64") },
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    }
  );
  const out = stdout.trim();
  if (!out) {
    throw new Error("DPAPI unprotect returned no data.");
  }
  return Buffer.from(out, "base64");
}

/** Reads + DPAPI-unwraps the profile's AES key from `Local State`. Cached per Local State path. */
async function getWindowsAesKey(localStatePath: string): Promise<Buffer> {
  const cached = aesKeyCache.get(localStatePath);
  if (cached) {
    return cached;
  }
  const raw = await readFile(localStatePath, "utf8");
  const parsed = JSON.parse(raw) as { os_crypt?: { encrypted_key?: string } };
  const encoded = parsed.os_crypt?.encrypted_key;
  if (!encoded) {
    throw new Error("Browser Local State has no os_crypt.encrypted_key.");
  }
  let keyBlob = Buffer.from(encoded, "base64");
  if (keyBlob.subarray(0, DPAPI_PREFIX.length).equals(DPAPI_PREFIX)) {
    keyBlob = keyBlob.subarray(DPAPI_PREFIX.length);
  }
  const key = await dpapiUnprotect(keyBlob);
  if (key.length !== 32) {
    throw new Error(`Unexpected AES key length ${key.length} (expected 32).`);
  }
  aesKeyCache.set(localStatePath, key);
  return key;
}

/** Reads the browser's Safe Storage password from the macOS Keychain and derives the AES-128 key. */
async function getMacAesKey(keychain: MacKeychainRef): Promise<Buffer> {
  const cacheKey = `mac:${keychain.service}:${keychain.account}`;
  const cached = aesKeyCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  let password: string;
  try {
    const { stdout } = await execFileAsync(
      "security",
      ["find-generic-password", "-w", "-s", keychain.service, "-a", keychain.account],
      { maxBuffer: 1024 * 1024 }
    );
    password = stdout.replace(/\n$/, "");
  } catch (error) {
    throw new KeychainAccessError(
      `Could not read the ${keychain.service} password from the macOS Keychain. ` +
        "When macOS asks, choose Always Allow, then reconnect." +
        (error instanceof Error ? ` (${error.message})` : "")
    );
  }
  if (!password) {
    throw new KeychainAccessError(`The macOS Keychain returned an empty ${keychain.service} password.`);
  }
  const key = pbkdf2Sync(password, MAC_SALT, MAC_ITERATIONS, MAC_KEY_LENGTH, "sha1");
  aesKeyCache.set(cacheKey, key);
  return key;
}

/**
 * Newer Chromium prepends a 32-byte SHA-256(host_key) to the plaintext value. Try the whole
 * buffer first; if it isn't clean printable text, try dropping a 32-byte prefix. Robust
 * regardless of what the hash's leading byte happens to be.
 */
function pickPlaintext(plain: Buffer): string {
  const printable = /^[\x20-\x7e]*$/;
  const whole = plain.toString("utf8");
  if (printable.test(whole)) {
    return whole;
  }
  if (plain.length > 32) {
    const tail = plain.subarray(32).toString("utf8");
    if (printable.test(tail)) {
      return tail;
    }
  }
  return whole;
}

const ABE_SENTINEL = " __APP_BOUND__ ";

async function decryptCookieValue(encrypted: Buffer, aesKey: Buffer): Promise<string> {
  if (encrypted.length === 0) {
    return "";
  }
  const prefix = encrypted.subarray(0, 3).toString("latin1");

  if (process.platform === "darwin") {
    // macOS Chromium: v10 → AES-128-CBC, 16-space IV, no auth tag.
    if (prefix === "v10" || prefix === "v11") {
      const ciphertext = encrypted.subarray(3);
      const decipher = createDecipheriv("aes-128-cbc", aesKey, MAC_IV);
      const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return pickPlaintext(plain);
    }
    // No prefix → value was stored unencrypted (older/edge cases).
    return encrypted.toString("utf8");
  }

  // Windows.
  if (prefix === "v10" || prefix === "v11") {
    const nonce = encrypted.subarray(3, 15);
    const tag = encrypted.subarray(encrypted.length - 16);
    const ciphertext = encrypted.subarray(15, encrypted.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", aesKey, nonce);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return pickPlaintext(plain);
  }
  if (prefix === "v20") {
    // App-Bound Encryption — cannot be decrypted outside the owning browser.
    return ABE_SENTINEL;
  }
  // Legacy: the whole blob is DPAPI-protected.
  const plain = await dpapiUnprotect(encrypted);
  return plain.toString("utf8");
}

/** Copies the (closed) Cookies DB plus any WAL/SHM sidecars to a private temp file. */
async function copyDbToTemp(cookieDbPath: string): Promise<string> {
  const tmpBase = path.join(
    os.tmpdir(),
    `amp-cookies-${process.pid}-${Date.now().toString(36)}.db`
  );
  await copyFile(cookieDbPath, tmpBase);
  for (const ext of ["-wal", "-shm"]) {
    try {
      await copyFile(cookieDbPath + ext, tmpBase + ext);
    } catch {
      // sidecar absent on a clean shutdown — fine.
    }
  }
  return tmpBase;
}

async function removeTemp(tmpBase: string): Promise<void> {
  for (const ext of ["", "-wal", "-shm"]) {
    await rm(tmpBase + ext, { force: true }).catch(() => undefined);
  }
}

/**
 * Reads and decrypts all cookies matching `hostLike` from a browser profile.
 * Browser-agnostic across Chrome/Edge/Brave — only the on-disk paths and key source differ.
 */
export async function readDecryptedCookies(options: ReadCookiesOptions): Promise<ReadCookiesResult> {
  assertSupportedPlatform();
  let aesKey: Buffer;
  if (process.platform === "darwin") {
    if (!options.macKeychain) {
      throw new Error("A macOS Keychain reference is required to decrypt cookies on this platform.");
    }
    aesKey = await getMacAesKey(options.macKeychain);
  } else {
    aesKey = await getWindowsAesKey(options.localStatePath);
  }

  const tmpBase = await copyDbToTemp(options.cookieDbPath);
  try {
    const db = new DatabaseSync(tmpBase, { readOnly: true });
    let rows: Array<{ hostKey: string; name: string; enc: Uint8Array }>;
    try {
      rows = db
        .prepare("SELECT host_key AS hostKey, name, encrypted_value AS enc FROM cookies WHERE host_key LIKE ?")
        .all(options.hostLike) as Array<{ hostKey: string; name: string; enc: Uint8Array }>;
    } finally {
      db.close();
    }

    const cookies: DecryptedCookie[] = [];
    let appBoundBlocked = false;
    for (const row of rows) {
      let value: string;
      try {
        value = await decryptCookieValue(Buffer.from(row.enc), aesKey);
      } catch {
        // A single undecryptable cookie should not abort the whole import.
        continue;
      }
      if (value === ABE_SENTINEL) {
        appBoundBlocked = true;
        continue;
      }
      cookies.push({ name: row.name, value, hostKey: row.hostKey });
    }
    return { cookies, appBoundBlocked };
  } finally {
    await removeTemp(tmpBase);
  }
}

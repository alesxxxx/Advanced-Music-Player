/*
 * verify-vmp.mjs — confirm a packaged AMP build carries castLabs production
 * VMP signatures (i.e. the EVS afterPack hook actually ran and succeeded).
 *
 * Usage:
 *   node scripts/verify-vmp.mjs [packagedDir]
 *
 * With no argument it scans the electron-builder output dir (default: ./dist)
 * for *-unpacked / mac app bundles and reports the .sig signature count.
 *
 * This is a heuristic acceptance check, not a cryptographic verification: EVS
 * writes a `.sig` sidecar next to each signed binary (electron exe, *.dll,
 * *.node, ...). Zero sig files => the build is still development-signed and will
 * 403 on the SoundCloud license server.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");

function collectSignatures(dir) {
  const sigs = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith(".sig")) {
        sigs.push(full);
      }
    }
  }
  return sigs;
}

function resolveTargets(explicit) {
  if (explicit) {
    return [path.resolve(explicit)];
  }
  const outDir = path.join(desktopRoot, "dist");
  let entries;
  try {
    entries = fs.readdirSync(outDir, { withFileTypes: true });
  } catch {
    return [];
  }
  // win-unpacked, linux-unpacked, mac, mac-arm64, etc.
  return entries
    .filter((entry) => entry.isDirectory() && /unpacked|^mac/i.test(entry.name))
    .map((entry) => path.join(outDir, entry.name));
}

const targets = resolveTargets(process.argv[2]);

if (targets.length === 0) {
  console.error(
    "[verify:vmp] No packaged app directory found. Build first with `pnpm --filter @amp/desktop dist`,\n" +
      "             or pass an explicit path: node scripts/verify-vmp.mjs <packagedDir>"
  );
  process.exit(2);
}

let totalSigs = 0;
for (const target of targets) {
  const sigs = collectSignatures(target);
  totalSigs += sigs.length;
  const status = sigs.length > 0 ? "OK" : "MISSING";
  console.log(`[verify:vmp] ${status}: ${sigs.length} .sig file(s) in ${target}`);
}

if (totalSigs === 0) {
  console.error(
    "\n[verify:vmp] FAIL — no VMP signatures found. This build is development-signed and\n" +
      "             will get HTTP 403 on the SoundCloud license server. Ensure the EVS\n" +
      "             account is set up and re-run the build. See apps/desktop/DRM-SIGNING.md."
  );
  process.exit(1);
}

console.log(`\n[verify:vmp] PASS — ${totalSigs} signature file(s) total. Build is VMP-signed.`);

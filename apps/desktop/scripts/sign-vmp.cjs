/*
 * electron-builder `afterPack` hook — castLabs EVS production VMP signing.
 *
 * WHY THIS EXISTS
 * ---------------
 * AMP ships the castLabs "Electron for Content Security" fork
 * (electron-releases#vXX+wvcus) so the real Widevine CDM is available. Out of the
 * box that fork carries a DEVELOPMENT VMP (Verified Media Path) signature, and
 * SoundCloud's KeyOS license server rejects development-signed clients with HTTP
 * 403 on the license POST — which is exactly the "specific songs that need
 * Widevine don't play" symptom.
 *
 * The fix is the official, Google-sanctioned path: replace the development VMP
 * signature in the packaged app with a PRODUCTION VMP signature issued by
 * castLabs' free EVS service. This makes our build a properly-certified Widevine
 * client (same mechanism TIDAL Hi-Fi / soundcloud-rpc / BetterSoundCloud use).
 * No DRM is circumvented: content is still only ever decrypted inside the CDM.
 *
 * PREREQUISITE (one-time, run by a human — see apps/desktop/DRM-SIGNING.md):
 *   pip install --upgrade castlabs-evs
 *   python -m castlabs_evs.account signup     # or: reauth
 *
 * This hook runs DURING `electron-builder` (i.e. `pnpm --filter @amp/desktop dist`),
 * after the app is packed into a directory but BEFORE the installer is assembled,
 * so the signature sidecar files get bundled into the installer.
 *
 * IMPORTANT: VMP signatures only apply to PACKAGED builds. `pnpm dev` / `electron .`
 * run unsigned and will still 403 on DRM tracks — test against a packaged build.
 *
 * Escape hatches:
 *   AMP_SKIP_VMP=1        Skip signing entirely (produces an unsigned build
 *                         that will NOT play DRM tracks — dev/CI convenience only).
 *   AMP_EVS_PYTHON=<path> Use a specific Python interpreter for the EVS tool.
 *   (Legacy MUSYNC_-prefixed variants are still honored.)
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function log(message) {
  console.log(`[vmp] ${message}`);
}

/** Pick a Python interpreter that can import the castlabs_evs module. */
function resolveEvsPython() {
  const candidates = [
    process.env.AMP_EVS_PYTHON,
    process.env.MUSYNC_EVS_PYTHON,
    "python",
    "python3",
    process.platform === "win32" ? "py" : undefined
  ].filter(Boolean);

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-c", "import castlabs_evs"], {
      stdio: "ignore",
      shell: false
    });
    if (probe.status === 0) {
      return candidate;
    }
  }
  return undefined;
}

/** Count VMP signature sidecar files under a directory (best-effort sanity check). */
function countSignatureFiles(dir) {
  let count = 0;
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
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Embed AMP's icon (and version/product metadata) into the packaged AMP.exe via rcedit.
 *
 * WHY HERE INSTEAD OF electron-builder's `signAndEditExecutable`:
 * That built-in path unpacks the `winCodeSign` toolchain, whose extraction creates symbolic
 * links and fails on machines without the symlink privilege (non-admin Windows, Developer Mode
 * off). So `signAndEditExecutable` stays false and we run rcedit ourselves — it's a standalone
 * resource editor that needs no symlinks, so it works on both local and CI builds.
 *
 * ORDER MATTERS: this runs BEFORE the EVS VMP signing below, so the production VMP signature is
 * computed over the already-icon-edited binary. Editing AFTER signing would invalidate the .sig
 * and break DRM playback.
 */
async function embedWindowsIcon(appOutDir) {
  const exePath = path.join(appOutDir, "AMP.exe");
  const iconPath = path.join(__dirname, "..", "build", "icon.ico");
  if (!fs.existsSync(exePath)) {
    log(`rcedit: ${exePath} not found — skipping icon embed.`);
    return;
  }
  if (!fs.existsSync(iconPath)) {
    log(`rcedit: ${iconPath} not found — skipping icon embed.`);
    return;
  }
  const pkg = require("../package.json");
  const rcedit = require("rcedit");
  await rcedit(exePath, {
    icon: iconPath,
    "file-version": pkg.version,
    "product-version": pkg.version,
    "version-string": {
      ProductName: "AMP",
      FileDescription: "AMP",
      CompanyName: pkg.author || "AMP",
      LegalCopyright: ""
    }
  });
  log(`rcedit: embedded build/icon.ico + version ${pkg.version} into AMP.exe`);
}

exports.default = async function signVmp(context) {
  const platform = context.electronPlatformName; // 'win32' | 'darwin' | 'linux'
  const appOutDir = context.appOutDir;

  // Embed the Windows app icon first (independent of VMP signing) so the taskbar / Start-menu /
  // pinned shortcut show AMP's icon instead of Electron's default. Must precede VMP signing.
  if (platform === "win32") {
    await embedWindowsIcon(appOutDir);
  }

  if (process.env.AMP_SKIP_VMP === "1" || process.env.MUSYNC_SKIP_VMP === "1") {
    log("AMP_SKIP_VMP=1 (or legacy MUSYNC_SKIP_VMP) set — skipping VMP signing. This build will NOT play Widevine-gated tracks.");
    return;
  }

  // Widevine VMP is a Windows/macOS concept; the castLabs Linux build is always
  // PLATFORM_UNVERIFIED, so there is nothing to sign there.
  if (platform === "linux") {
    log("Linux target — no VMP signing applies (build stays PLATFORM_UNVERIFIED).");
    return;
  }

  const python = resolveEvsPython();
  if (!python) {
    throw new Error(
      [
        "castLabs EVS tool not found — cannot apply the production VMP signature.",
        "Without it, packaged builds get HTTP 403 on the SoundCloud license server",
        "and Widevine-gated tracks will not play.",
        "",
        "Fix (one-time):",
        "  pip install --upgrade castlabs-evs",
        "  python -m castlabs_evs.account signup        # verify via the emailed link",
        "",
        "See apps/desktop/DRM-SIGNING.md for the full runbook.",
        "To deliberately build WITHOUT DRM signing, set AMP_SKIP_VMP=1."
      ].join("\n")
    );
  }

  log(`Signing packaged app with castLabs EVS production VMP: ${appOutDir}`);
  const result = spawnSync(python, ["-m", "castlabs_evs.vmp", "sign-pkg", appOutDir], {
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    throw new Error(`EVS VMP signing failed to launch: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `EVS VMP signing exited with code ${result.status}.`,
        "Common causes: not signed in (run `python -m castlabs_evs.account reauth`),",
        "expired session, or no network. See apps/desktop/DRM-SIGNING.md."
      ].join("\n")
    );
  }

  const sigCount = countSignatureFiles(appOutDir);
  if (sigCount === 0) {
    throw new Error(
      "EVS reported success but no .sig signature files were found in the packaged app. " +
        "The build is almost certainly still development-signed — refusing to continue."
    );
  }
  log(`VMP signing complete — ${sigCount} signature file(s) embedded.`);
};

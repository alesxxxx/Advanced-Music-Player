// Helpers for surfacing SoundCloud's DataDome human-check during a like. Pure (no Electron/Node deps)
// so they can be unit-tested; the orchestration that uses them lives in main.ts.

/**
 * Pulls the challenge URL out of a DataDome 403 body. The body is JSON like
 * `{"url":"https://geo.captcha-delivery.com/captcha/?..."}`, but the URL is long, so we try JSON
 * first and fall back to a plain regex — robust to a truncated body or a non-JSON wrapper.
 */
export function extractDataDomeCaptchaUrl(body?: string): string | undefined {
  if (!body) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(body) as { url?: unknown };
    if (typeof parsed.url === "string" && parsed.url) {
      return parsed.url;
    }
  } catch {
    // truncated or not pure JSON — fall through to the regex
  }
  const match = body.match(/https?:(?:\\\/|\/)\/[^"'\s\\]*captcha-delivery\.com[^"'\s\\]*/i);
  return match ? match[0].replace(/\\\//g, "/") : undefined;
}

/**
 * Builds the in-page script that overlays DataDome's check on the current soundcloud.com page (as an
 * iframe, the way SoundCloud's own site embeds it) so the page origin stays correct for the like
 * retry. Runs via `webContents.executeJavaScript` inside the hidden like window.
 */
export function buildCaptchaOverlayScript(captchaUrl: string): string {
  return `(() => {
    document.getElementById('amp-datadome')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'amp-datadome';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0d0d0f;display:flex;flex-direction:column;font-family:system-ui,-apple-system,sans-serif';
    const bar = document.createElement('div');
    bar.style.cssText = 'padding:14px 18px;color:#f4f2ed;background:#161618;font-size:13px;font-weight:600;flex:0 0 auto';
    bar.textContent = "Quick human check to save your like — solve below. This only happens occasionally.";
    const frame = document.createElement('iframe');
    frame.src = ${JSON.stringify(captchaUrl)};
    frame.style.cssText = 'flex:1 1 auto;border:0;width:100%';
    overlay.appendChild(bar);
    overlay.appendChild(frame);
    (document.body || document.documentElement).appendChild(overlay);
  })()`;
}

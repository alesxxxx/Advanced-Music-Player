// Verifies the EXACT transcoding-resolution logic the gateway now uses, against the live
// SoundCloud API, for specific tracks. Mirrors SoundCloudInternalGateway.scoreTranscoding /
// orderedPlayableTranscodings / resolveStream (the progressive-preferred order), so we can
// confirm a problem track (e.g. "soul hurt by sgpwes") now gets a resolvable PROGRESSIVE
// stream where the old HLS-first path failed — without launching the GUI.
//
// Run:  node apps/desktop/scripts/verify-track-resolve.mjs
//       node apps/desktop/scripts/verify-track-resolve.mjs "some other search"

const WEB = "https://soundcloud.com";
const API = "https://api-v2.soundcloud.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const scOrigin = { Origin: WEB, Referer: WEB + "/" };

function extractClientId(src) {
  for (const p of [/[{,]client_id:"(\w+)"/, /"clientId":"(\w+?)"/, /"client_id":"(\w+)"/, /client_id=(\w+)/]) {
    const m = src.match(p);
    if (m?.[1] && m[1].length > 10) return m[1];
  }
  return undefined;
}
function extractJsUrls(html) {
  const urls = [];
  const re = /<script[^>]+src="([^"]+\.js)"/g;
  let m;
  while ((m = re.exec(html)) !== null) if (m[1].startsWith("http")) urls.push(m[1]);
  return urls;
}
const get = (url, extra = {}) => fetch(url, { headers: { "User-Agent": UA, ...extra } });

async function discoverClientId() {
  const html = await (await get(WEB)).text();
  const inline = extractClientId(html);
  if (inline) return inline;
  for (const js of extractJsUrls(html).slice(0, 12)) {
    try {
      const id = extractClientId(await (await get(js)).text());
      if (id) return id;
    } catch {}
  }
  return undefined;
}

// --- mirror of gateway scoreTranscoding ---
function scoreTranscoding(t) {
  const protocol = t.format?.protocol ?? "";
  const preset = t.preset ?? "";
  let score = 0;
  if (protocol === "progressive") score += 32;
  if (protocol === "hls") score += 26;
  if (/mp3/i.test(preset)) score += 25;
  else if (/aac/i.test(preset)) score += 15;
  if (/160/.test(preset)) score += 8;
  if (/abr/i.test(preset)) score -= 25;
  if (/preview/i.test(preset)) score -= 30;
  return score;
}
function orderedPlayable(transcodings) {
  return [...(transcodings ?? [])]
    .filter((t) => {
      const protocol = t.format?.protocol ?? "";
      return Boolean(t.url) && (protocol === "hls" || protocol === "progressive");
    })
    .map((t) => ({ t, score: scoreTranscoding(t) }))
    .sort((a, b) => b.score - a.score)
    .map((e) => e.t);
}

async function resolveLikeGateway(track, clientId) {
  const transcodings = track.media?.transcodings ?? [];
  console.log(`   transcodings (${transcodings.length}):`);
  for (const tr of transcodings) {
    console.log(
      `     - protocol=${tr.format?.protocol ?? "?"}  preset=${tr.preset ?? "?"}  ` +
        `mime=${tr.format?.mime_type ?? "?"}  quality=${tr.quality ?? "?"}  snipped=${tr.snipped ?? false}`
    );
  }
  const drm = transcodings.find((t) => (t.format?.protocol ?? "").includes("ctr-encrypted-hls"));
  const candidates = orderedPlayable(transcodings);
  console.log(
    `   ordered playable (progressive-first): ${
      candidates.map((c) => `${c.format?.protocol}/${c.preset}[${scoreTranscoding(c)}]`).join(", ") || "(none)"
    }`
  );
  if (drm) console.log(`   ⚠ DRM transcoding present (ctr-encrypted-hls) → needs OAuth + Widevine (monetized/Go+).`);

  for (const tr of candidates) {
    const u = new URL(tr.url);
    u.searchParams.set("client_id", clientId);
    if (track.track_authorization) u.searchParams.set("track_authorization", track.track_authorization);
    const res = await get(u, scOrigin);
    if (!res.ok) {
      console.log(`   try ${tr.format?.protocol}/${tr.preset} → HTTP ${res.status} (skip, try next)`);
      continue;
    }
    const json = await res.json();
    if (!json.url) {
      console.log(`   try ${tr.format?.protocol}/${tr.preset} → 200 but no url (skip)`);
      continue;
    }
    // Fetch the actual stream head to confirm it's truly reachable.
    const man = await get(json.url);
    let detail = `HTTP ${man.status} ${man.headers.get("content-type") ?? ""}`;
    if (res.ok && tr.format?.protocol === "hls" && man.ok) {
      const first = (await man.text()).split("\n")[0];
      detail += `  manifest="${first}"`;
    }
    const ok = man.ok;
    console.log(`   ✅ RESOLVED via ${tr.format?.protocol}/${tr.preset} → ${detail}`);
    return { ok, protocol: tr.format?.protocol, preset: tr.preset };
  }
  if (drm) return { ok: false, drmOnly: true };
  return { ok: false };
}

async function findAndResolve(query) {
  console.log(`\n================  "${query}"  ================`);
  const clientId = await discoverClientId();
  if (!clientId) {
    console.error("FAIL: no client_id");
    return;
  }
  const url = new URL(`${API}/search/tracks`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  url.searchParams.set("client_id", clientId);
  const res = await get(url, scOrigin);
  if (!res.ok) {
    console.error(`FAIL: search HTTP ${res.status}`);
    return;
  }
  const data = await res.json();
  const results = data.collection ?? [];
  console.log(`found ${results.length} results:`);
  results.forEach((t, i) =>
    console.log(`  [${i}] "${t.title}" — ${t.user?.username}  policy=${t.policy ?? "?"}  plays=${t.playback_count ?? "?"}  ${Math.round((t.duration ?? 0) / 1000)}s`)
  );

  // Resolve EVERY result (capped) so we can tell which variants play anonymously via progressive
  // and which are genuinely DRM-only — a re-upload playing doesn't prove the original does.
  const limit = Math.min(results.length, 6);
  for (let i = 0; i < limit; i++) {
    const pick = results[i];
    console.log(`\n→ resolving [${i}] "${pick.title}" — ${pick.user?.username} (policy=${pick.policy ?? "?"}, plays=${pick.playback_count ?? "?"})`);
    const outcome = await resolveLikeGateway(pick, clientId);
    console.log(
      `RESULT [${i}]: ${
        outcome.ok
          ? `PLAYABLE via ${outcome.protocol}/${outcome.preset}`
          : outcome.drmOnly
          ? "DRM-ONLY (only ctr-encrypted-hls) — needs OAuth+Widevine"
          : "NOT PLAYABLE anonymously"
      }`
    );
  }
}

const queries = process.argv[2]
  ? [process.argv[2]]
  : ["soul hurt sgpwes", "i dont even sleep goonie"];
for (const q of queries) {
  await findAndResolve(q);
}

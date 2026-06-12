// Verifies the SoundCloud ANONYMOUS playback pipeline end-to-end against the live API:
//   client_id scrape  ->  search  ->  transcoding resolve  ->  stream manifest fetch
//
// This is the exact handshake SoundCloudInternalGateway performs, with no login.
// Run:  node apps/desktop/scripts/verify-soundcloud.mjs "search terms"
//
// Exit code 0 = the no-login search+stream path works on this machine right now.

const WEB = "https://soundcloud.com";
const API = "https://api-v2.soundcloud.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

function extractClientId(src) {
  const patterns = [
    /[{,]client_id:"(\w+)"/,
    /"clientId":"(\w+?)"/,
    /"client_id":"(\w+)"/,
    /client_id=(\w+)/
  ];
  for (const p of patterns) {
    const m = src.match(p);
    if (m?.[1] && m[1].length > 10) return m[1];
  }
  return undefined;
}

function extractJsUrls(html) {
  const urls = [];
  const re = /<script[^>]+src="([^"]+\.js)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].startsWith("http")) urls.push(m[1]);
  }
  return urls;
}

async function get(url, extra = {}) {
  return fetch(url, { headers: { "User-Agent": UA, ...extra } });
}

async function discoverClientId() {
  const html = await (await get(WEB)).text();
  const inline = extractClientId(html);
  if (inline) return { id: inline, from: "inline html" };
  for (const js of extractJsUrls(html).slice(0, 12)) {
    try {
      const body = await (await get(js)).text();
      const id = extractClientId(body);
      if (id) return { id, from: "js bundle" };
    } catch {
      // try next bundle
    }
  }
  return {};
}

const query = process.argv[2] ?? "flume";
const scOrigin = { Origin: WEB, Referer: WEB + "/" };

console.log(`[1/4] Discovering anonymous client_id...`);
const { id: clientId, from } = await discoverClientId();
if (!clientId) {
  console.error("   FAIL: could not scrape a client_id from soundcloud.com");
  process.exit(1);
}
console.log(`   ok  client_id=${clientId.slice(0, 6)}…  (from ${from})`);

console.log(`[2/4] Searching api-v2 for "${query}" (no login)...`);
const searchUrl = new URL(`${API}/search/tracks`);
searchUrl.searchParams.set("q", query);
searchUrl.searchParams.set("limit", "5");
searchUrl.searchParams.set("client_id", clientId);
const searchRes = await get(searchUrl, scOrigin);
if (!searchRes.ok) {
  console.error(`   FAIL: search returned HTTP ${searchRes.status}`);
  process.exit(1);
}
const search = await searchRes.json();
const tracks = (search.collection ?? []).filter(
  (t) => t.streamable !== false && t.media?.transcodings?.length
);
console.log(`   ok  ${search.collection?.length ?? 0} results, ${tracks.length} streamable`);
if (!tracks.length) {
  console.error("   FAIL: no streamable tracks returned");
  process.exit(1);
}
const track = tracks[0];
console.log(
  `   pick: "${track.title}" — ${track.user?.username} (${Math.round((track.duration ?? 0) / 1000)}s)`
);

console.log(`[3/4] Resolving a playable stream URL...`);
const transcodings = track.media.transcodings;
const chosen = transcodings.find((t) => t.format?.protocol === "hls") ?? transcodings[0];
const tUrl = new URL(chosen.url);
tUrl.searchParams.set("client_id", clientId);
if (track.track_authorization) tUrl.searchParams.set("track_authorization", track.track_authorization);
const streamRes = await get(tUrl, scOrigin);
if (!streamRes.ok) {
  console.error(`   FAIL: transcoding resolve returned HTTP ${streamRes.status}`);
  process.exit(1);
}
const stream = await streamRes.json();
if (!stream.url) {
  console.error("   FAIL: transcoding response had no stream url");
  process.exit(1);
}
console.log(`   ok  protocol=${chosen.format?.protocol}  ${stream.url.slice(0, 64)}…`);

console.log(`[4/4] Fetching the stream manifest/header...`);
const manRes = await get(stream.url);
console.log(`   HTTP ${manRes.status}  content-type=${manRes.headers.get("content-type")}`);
if (!manRes.ok) {
  console.error(`\n❌ Stream URL was not reachable (HTTP ${manRes.status}).`);
  process.exit(1);
}
if (chosen.format?.protocol === "hls") {
  const body = await manRes.text();
  const firstLine = body.split("\n")[0];
  console.log(`   manifest starts with: ${firstLine}`);
  if (!firstLine.startsWith("#EXTM3U")) {
    console.error("\n❌ Resolved URL did not return a valid HLS manifest.");
    process.exit(1);
  }
}
console.log("\n✅ SoundCloud anonymous search + streaming pipeline WORKS end-to-end (no login).");

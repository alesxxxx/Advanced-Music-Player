import { fileURLToPath, pathToFileURL } from "node:url";

const modPath = fileURLToPath(new URL("../electron/chromiumRemoteSession.ts", import.meta.url));
const { describeRemoteLikeFailure, buildSoundCloudLikeScript } = await import(pathToFileURL(modPath).href);

let failures = 0;
const assert = (condition, message) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
};

// --- describeRemoteLikeFailure ---
assert(
  describeRemoteLikeFailure({ ok: true, stage: "write", status: 200 }) === "",
  "a successful like has no error message"
);

assert(
  /reconnect/i.test(describeRemoteLikeFailure({ ok: false, stage: "me", status: 401 })),
  "a 401 on /me reads as an expired sign-in that needs reconnect"
);

assert(
  /anti-bot|verify|try again/i.test(
    describeRemoteLikeFailure({ ok: false, stage: "write", status: 403, body: '{"url":"https://captcha-delivery.com/..."}' })
  ),
  "a DataDome captcha body reads as an anti-bot block"
);

assert(
  /anti-bot|verify|try again/i.test(describeRemoteLikeFailure({ ok: false, stage: "write", status: 429 })),
  "a 429 reads as a rate-limit/anti-bot block"
);

assert(
  /browser/i.test(describeRemoteLikeFailure({ ok: false, stage: "endpoint", status: 0, message: "no endpoint" })),
  "a CDP endpoint failure reads as a browser-reachability problem (eligible for fallback)"
);

assert(
  /HTTP 500/.test(describeRemoteLikeFailure({ ok: false, stage: "write", status: 500 })),
  "an unexpected HTTP status is surfaced verbatim"
);

// --- buildSoundCloudLikeScript ---
const putScript = buildSoundCloudLikeScript("tok\"en", "client123", "98765", true);
assert(putScript.includes("'PUT'") || putScript.includes('"PUT"'), "liking issues a PUT");
assert(putScript.includes("98765"), "the track id is embedded in the script");
assert(putScript.includes("client123"), "the client id is embedded in the script");
assert(!putScript.includes('OAuth tok"en'), "the oauth token is JSON-escaped, not raw-interpolated");
const deleteScript = buildSoundCloudLikeScript("token", "client123", "98765", false);
assert(deleteScript.includes("'DELETE'") || deleteScript.includes('"DELETE"'), "unliking issues a DELETE");

if (failures > 0) {
  console.error(`\n${failures} remote-like test(s) failed.`);
  process.exit(1);
}
console.log("PASS: remote-like tests completed.");

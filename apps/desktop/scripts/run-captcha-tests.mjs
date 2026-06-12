import { fileURLToPath, pathToFileURL } from "node:url";

const modPath = fileURLToPath(new URL("../electron/soundcloudCaptcha.ts", import.meta.url));
const { extractDataDomeCaptchaUrl, buildCaptchaOverlayScript } = await import(pathToFileURL(modPath).href);

let failures = 0;
const assert = (condition, message) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
};

const realUrl =
  "https://geo.captcha-delivery.com/captcha/?initialCid=AHrlqAAAAAMAfJuEj79QREcAa4raIA==&cid=GloBaH4QuhjTolr0j8QLLbV8bw0P4r9ZjQPQDWCzooYIi5aJXnE2ChWavsUb3UFq2~CaVmBxmN0Mbw40Ikk&hash=ABC123&t=fe&s=40000&e=def";
const fullBody = JSON.stringify({ url: realUrl, cid: "GloBaH" });

assert(extractDataDomeCaptchaUrl(fullBody) === realUrl, "extracts the url from a full JSON body");

// Truncated mid-JSON (the bug we hit: slice cut the JSON so JSON.parse throws) — regex still recovers
// the (partial) url, which must at least start at the captcha-delivery origin.
const truncated = fullBody.slice(0, 160);
const fromTruncated = extractDataDomeCaptchaUrl(truncated);
assert(
  Boolean(fromTruncated) && fromTruncated.startsWith("https://geo.captcha-delivery.com/"),
  "recovers a captcha-delivery url from a truncated body via regex"
);

// Escaped slashes (some wrappers JSON-escape the url).
const escaped = '{"url":"https:\\/\\/geo.captcha-delivery.com\\/captcha\\/?cid=x"}';
assert(
  extractDataDomeCaptchaUrl(escaped) === "https://geo.captcha-delivery.com/captcha/?cid=x",
  "unescapes JSON-escaped slashes"
);

assert(extractDataDomeCaptchaUrl(undefined) === undefined, "undefined body yields undefined");
assert(extractDataDomeCaptchaUrl("") === undefined, "empty body yields undefined");
assert(
  extractDataDomeCaptchaUrl('{"error":"forbidden"}') === undefined,
  "a non-captcha 403 body yields undefined"
);

const overlay = buildCaptchaOverlayScript(realUrl);
assert(overlay.includes("amp-datadome"), "overlay uses the removable marker id");
assert(overlay.includes("iframe"), "overlay embeds the check in an iframe");
assert(overlay.includes(JSON.stringify(realUrl)), "overlay injects the captcha url JSON-safely");

if (failures > 0) {
  console.error(`\n${failures} captcha test(s) failed.`);
  process.exit(1);
}
console.log("PASS: captcha tests completed.");

import type { Provider, UnifiedTrack } from "@amp/core";

const providerPalette: Record<Provider, { background: string; accent: string; shadow: string }> = {
  spotify: {
    background: "#102117",
    accent: "#1ed760",
    shadow: "#0b1510"
  },
  soundcloud: {
    background: "#26150b",
    accent: "#ff6a1a",
    shadow: "#160f0b"
  }
};

/** Drops lone surrogates (e.g. an emoji title sliced in half) so encodeURIComponent can't throw. */
function stripLoneSurrogates(value: string): string {
  return value.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    ""
  );
}

function encodeSvg(markup: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(stripLoneSurrogates(markup))}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function createMonogram(track: Pick<UnifiedTrack, "title" | "creators">): string {
  // Use Array.from so the "first character" is a whole code point — indexing with [0] would split
  // an emoji's surrogate pair and produce an invalid lone surrogate.
  const firstCodePoint = (part: string) => Array.from(part)[0]?.toUpperCase() ?? "";
  const fromTitle = track.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(firstCodePoint)
    .join("");

  if (fromTitle) {
    return fromTitle;
  }

  return firstCodePoint(track.creators[0] ?? "") || "SC";
}

export function createArtworkFallbackDataUrl(
  provider: Provider,
  track: Pick<UnifiedTrack, "title" | "creators">
): string {
  const palette = providerPalette[provider];
  const monogram = createMonogram(track);
  const subtitle = escapeXml((track.creators[0] ?? provider).slice(0, 22));

  return encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${palette.background}" />
          <stop offset="100%" stop-color="${palette.shadow}" />
        </linearGradient>
      </defs>
      <rect width="640" height="640" rx="72" fill="url(#bg)" />
      <circle cx="504" cy="136" r="56" fill="${palette.accent}" fill-opacity="0.18" />
      <circle cx="136" cy="504" r="84" fill="${palette.accent}" fill-opacity="0.12" />
      <rect x="72" y="72" width="496" height="496" rx="52" fill="none" stroke="${palette.accent}" stroke-opacity="0.22" />
      <text x="88" y="280" fill="#f5efe4" font-size="156" font-family="Space Grotesk, Arial, sans-serif" font-weight="700">${escapeXml(monogram)}</text>
      <text x="88" y="396" fill="#f5efe4" font-size="46" font-family="IBM Plex Sans, Arial, sans-serif">${provider.toUpperCase()}</text>
      <text x="88" y="454" fill="#b8afa2" font-size="34" font-family="IBM Plex Sans, Arial, sans-serif">${subtitle}</text>
    </svg>
  `);
}

export function createSeededArtworkDataUrl(
  provider: Provider,
  title: string,
  creators: string[],
  mood: "pulse" | "glow" | "drift"
): string {
  const palette = providerPalette[provider];
  const accent = palette.accent;
  const safeTitle = escapeXml(title.slice(0, 22));
  const safeCreator = escapeXml(creators[0] ?? provider);
  const overlay =
    mood === "pulse"
      ? `<path d="M82 366C162 268 228 252 320 320C416 394 486 376 558 280" fill="none" stroke="${accent}" stroke-width="18" stroke-linecap="round"/>`
      : mood === "glow"
        ? `<circle cx="352" cy="246" r="128" fill="${accent}" fill-opacity="0.32"/><circle cx="238" cy="362" r="92" fill="#f5efe4" fill-opacity="0.12"/>`
        : `<path d="M130 212C194 148 278 132 356 166C430 198 492 270 534 430" fill="none" stroke="${accent}" stroke-width="22" stroke-linecap="round"/>`;

  return encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${palette.shadow}" />
          <stop offset="100%" stop-color="${palette.background}" />
        </linearGradient>
      </defs>
      <rect width="640" height="640" rx="72" fill="url(#bg)" />
      <rect x="74" y="74" width="492" height="492" rx="48" fill="none" stroke="${accent}" stroke-opacity="0.24" />
      ${overlay}
      <text x="88" y="470" fill="#f5efe4" font-size="58" font-family="Space Grotesk, Arial, sans-serif" font-weight="700">${safeTitle}</text>
      <text x="88" y="526" fill="#b8afa2" font-size="34" font-family="IBM Plex Sans, Arial, sans-serif">${safeCreator}</text>
    </svg>
  `);
}

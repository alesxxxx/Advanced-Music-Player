/**
 * Collapse the noisy, hyper-specific genre strings that Spotify (artist genres like "atl hip hop",
 * "melodic drill") and SoundCloud (free-text per-track tags) hand us into a small set of top-level
 * buckets suitable for library filter chips — mirroring the genre chips Spotify shows on Liked
 * Songs. Pure and dependency-free so it can be unit-tested in isolation and reused by the radio
 * scorer's genre gate.
 */

/** Display order / canonical set of top-level genre chips. */
export const TOP_LEVEL_GENRES = [
  "Hip Hop",
  "Rap",
  "Pop",
  "R&B",
  "Rock",
  "Indie",
  "Electronic",
  "Dance",
  "House",
  "Techno",
  "Drum & Bass",
  "Dubstep",
  "Trap",
  "Latin",
  "Reggaeton",
  "Country",
  "Metal",
  "Punk",
  "Jazz",
  "Soul",
  "Funk",
  "Folk",
  "Classical",
  "Ambient",
  "Lo-Fi",
  "K-Pop",
  "Afrobeats",
  "Reggae",
  "Phonk",
  "Hyperpop"
] as const;

export type TopLevelGenre = (typeof TOP_LEVEL_GENRES)[number];

/**
 * Ordered list of [substring-to-match, bucket]. The FIRST match wins, so more specific patterns
 * are listed before broader ones (e.g. "k-pop" before "pop", "drum and bass" before "bass").
 */
const RULES: Array<[RegExp, TopLevelGenre]> = [
  [/\bk[\s-]?pop\b|korean/, "K-Pop"],
  [/hyperpop|hyper pop|glitchcore|digicore/, "Hyperpop"],
  [/phonk/, "Phonk"],
  [/lo[\s-]?fi|lofi|chillhop|chill hop/, "Lo-Fi"],
  [/drum\s*(?:and|&|n)?\s*bass|\bdnb\b|jungle/, "Drum & Bass"],
  [/dubstep|riddim|brostep/, "Dubstep"],
  [/reggaeton|perreo|dembow/, "Reggaeton"],
  [/afrobeat|afrobeats|afropop|amapiano/, "Afrobeats"],
  [/reggae|dancehall|ska/, "Reggae"],
  [/\btrap\b|drill/, "Trap"],
  [/\bhouse\b|deep house|tech house|future house/, "House"],
  [/techno/, "Techno"],
  [/\btrance\b|hardstyle|hardcore techno|\bedm\b|electro\b/, "Electronic"],
  [/\bdance\b/, "Dance"],
  [/ambient|drone|new age/, "Ambient"],
  [/\bhip[\s-]?hop\b|boom bap|cloud rap|underground hip/, "Hip Hop"],
  [/\brap\b|rapper|gangsta/, "Rap"],
  [/r&b|rnb|rhythm and blues|contemporary r/, "R&B"],
  [/\bsoul\b|neo soul|motown/, "Soul"],
  [/\bfunk\b/, "Funk"],
  [/\bindie\b|bedroom pop|shoegaze|dream pop/, "Indie"],
  [/\bmetal\b|metalcore|deathcore|djent/, "Metal"],
  [/\bpunk\b|emo|hardcore punk/, "Punk"],
  [/\bjazz\b|bebop|swing/, "Jazz"],
  [/classical|orchestra|symphony|baroque|piano sonata/, "Classical"],
  [/\bfolk\b|singer.songwriter|americana|bluegrass/, "Folk"],
  [/\bcountry\b/, "Country"],
  [/\bhouse|electronic|electronica|synthwave|idm|breakbeat|garage/, "Electronic"],
  [/\brock\b|alt rock|alternative|grunge|post rock|hard rock/, "Rock"],
  [/latin|salsa|bachata|cumbia|corrido|regional mexican|musica/, "Latin"],
  [/\bpop\b/, "Pop"]
];

/** Normalize one raw genre/tag string to a top-level bucket, or `null` if it maps to nothing. */
export function normalizeGenre(raw: string | undefined | null): TopLevelGenre | null {
  if (!raw) {
    return null;
  }
  const value = raw.toLowerCase().trim();
  if (!value) {
    return null;
  }
  for (const [pattern, bucket] of RULES) {
    if (pattern.test(value)) {
      return bucket;
    }
  }
  return null;
}

/** Normalize many raw genres/tags into a de-duplicated list of top-level buckets. */
export function normalizeGenres(raws: Array<string | undefined | null>): TopLevelGenre[] {
  const out: TopLevelGenre[] = [];
  const seen = new Set<TopLevelGenre>();
  for (const raw of raws) {
    const bucket = normalizeGenre(raw);
    if (bucket && !seen.has(bucket)) {
      seen.add(bucket);
      out.push(bucket);
    }
  }
  return out;
}

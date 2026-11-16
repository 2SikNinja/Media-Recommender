import { normalizeText } from "./tracks";

const deezerSearchUrl = "https://api.deezer.com/search/track";
const requestTimeoutMs = 5_000;
const searchResultLimit = 5;

export class DeezerError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "DeezerError";
  }
}

type DeezerTrack = {
  title?: unknown;
  preview?: unknown;
  artist?: { name?: unknown };
  album?: { cover_medium?: unknown };
};

/**
 * Only Deezer's own servers (covers and preview clips both live on dzcdn.net),
 * so the art and preview endpoints can't be used to redirect anywhere else.
 */
export function isDeezerCdnUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "dzcdn.net" || url.hostname.endsWith(".dzcdn.net"));
  } catch {
    return false;
  }
}

function matches(expected: string, actual: unknown): boolean {
  if (typeof actual !== "string") return false;
  const expectedText = normalizeText(expected);
  const actualText = normalizeText(actual);
  return expectedText.length > 0 && (actualText.includes(expectedText) || expectedText.includes(actualText));
}

async function searchDeezer(query: string, fetchImpl: typeof fetch): Promise<DeezerTrack[]> {
  const url = new URL(deezerSearchUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(searchResultLimit));

  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(requestTimeoutMs), cache: "no-store" });
  } catch (error) {
    throw new DeezerError("Deezer request failed", error);
  }
  const body = (await response.json().catch(() => null)) as { data?: unknown; error?: { message?: string } } | null;
  // Deezer reports errors, including rate limits, as HTTP 200 with an error object.
  if (!response.ok || !body || body.error) {
    throw new DeezerError(`Deezer search failed: ${body?.error?.message ?? `HTTP ${response.status}`}`);
  }
  return Array.isArray(body.data) ? (body.data as DeezerTrack[]) : [];
}

/**
 * Searches Deezer with the strict artist/track query first, then a plain one
 * (the strict query misses titles with punctuation). For each query, `pick`
 * chooses from the results by the same artist; the first non-null answer wins.
 */
async function findOnDeezer(
  artist: string,
  title: string,
  fetchImpl: typeof fetch,
  pick: (sameArtist: DeezerTrack[]) => string | null,
): Promise<string | null> {
  const queries = [`artist:"${artist}" track:"${title}"`, `${artist} ${title}`];
  for (const query of queries) {
    const results = await searchDeezer(query, fetchImpl);
    const found = pick(results.filter((track) => matches(artist, track.artist?.name)));
    if (found) return found;
  }
  return null;
}

/**
 * Finds the album cover for a song on Deezer. Another song by the same artist
 * is an acceptable stand-in, but never another artist's cover.
 */
export function findAlbumArt(artist: string, title: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  return findOnDeezer(artist, title, fetchImpl, (sameArtist) => {
    const best = sameArtist.find((track) => matches(title, track.title)) ?? sameArtist[0];
    const cover = best?.album?.cover_medium;
    return isDeezerCdnUrl(cover) ? cover : null;
  });
}

/**
 * Finds Deezer's 30-second preview clip for a song. Unlike covers, only the
 * same song counts: a clip of a different song would be misleading.
 */
export function findPreviewUrl(artist: string, title: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  return findOnDeezer(artist, title, fetchImpl, (sameArtist) => {
    const sameSong = sameArtist.find((track) => matches(title, track.title) && isDeezerCdnUrl(track.preview));
    return sameSong ? (sameSong.preview as string) : null;
  });
}

const defaultPreviewCacheSeconds = 300;
const maxPreviewCacheSeconds = 3_600;
const expirySafetySeconds = 60;

/**
 * How long a preview URL can be cached. Deezer signs preview URLs with an
 * expiry (`hdnea=exp=<unix seconds>~...`), so a cached redirect must not
 * outlive it. Returns 0 when the URL is about to expire.
 */
export function previewCacheSeconds(previewUrl: string, nowMs: number = Date.now()): number {
  const expiry = /(?:^|[?&~=])exp=(\d+)/.exec(decodeURIComponent(previewUrl))?.[1];
  if (!expiry) return defaultPreviewCacheSeconds;
  const remaining = Number(expiry) - Math.floor(nowMs / 1000) - expirySafetySeconds;
  return Math.max(0, Math.min(maxPreviewCacheSeconds, remaining));
}

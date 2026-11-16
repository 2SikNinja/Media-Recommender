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
  artist?: { name?: unknown };
  album?: { cover_medium?: unknown };
};

/** Only Deezer's own image servers, so the art endpoint can't be used to redirect anywhere else. */
export function isDeezerImageUrl(value: unknown): value is string {
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
 * Finds the album cover for a song on Deezer. Returns null when Deezer has no
 * result by the same artist, rather than showing some other artist's cover.
 */
export async function findAlbumArt(artist: string, title: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const queries = [`artist:"${artist}" track:"${title}"`, `${artist} ${title}`];
  for (const query of queries) {
    const results = await searchDeezer(query, fetchImpl);
    const sameArtist = results.filter((track) => matches(artist, track.artist?.name));
    const best = sameArtist.find((track) => matches(title, track.title)) ?? sameArtist[0];
    const cover = best?.album?.cover_medium;
    if (isDeezerImageUrl(cover)) return cover;
  }
  return null;
}

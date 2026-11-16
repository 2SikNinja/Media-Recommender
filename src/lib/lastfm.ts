import { makeTrackKey, type SimilarTrack, type Track } from "./tracks";

const lastfmBaseUrl = "https://ws.audioscrobbler.com/2.0/";
const requestTimeoutMs = 8000;

// Last.fm returns this star image when it has no real artwork.
const placeholderImageHash = "2a96cbd8b46e442fc41c2b86b821562f";

// Last.fm error codes we handle specially. https://www.last.fm/api/errorcodes
const lastfmNotFound = 6;

export class LastfmError extends Error {
  readonly lastfmCode: number | null;
  readonly httpStatus: number | null;

  constructor(message: string, lastfmCode: number | null, httpStatus: number | null, cause?: unknown) {
    super(message, { cause });
    this.name = "LastfmError";
    this.lastfmCode = lastfmCode;
    this.httpStatus = httpStatus;
  }
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  // Last.fm returns a bare object instead of a one-item array when there is a single result.
  return asObject(value) ? [value] : [];
}

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function pickImageUrl(images: unknown): string | null {
  const urls = asArray(images)
    .map((image) => asText(asObject(image)?.["#text"]))
    .filter((url): url is string => url !== null && !url.includes(placeholderImageHash));
  // Images are listed smallest to largest.
  return urls.length > 0 ? urls[urls.length - 1] : null;
}

function positiveSecondsOrNull(seconds: number | null): number | null {
  return seconds !== null && seconds > 0 ? Math.round(seconds) : null;
}

async function callLastfm(method: string, params: Record<string, string>): Promise<JsonObject> {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) {
    throw new LastfmError("LASTFM_API_KEY is not set", null, null);
  }

  const url = new URL(lastfmBaseUrl);
  url.searchParams.set("method", method);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("format", "json");
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "Pickify/0.1 (github.com/2SikNinja/Pickify)" },
      signal: AbortSignal.timeout(requestTimeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    throw new LastfmError(`Last.fm ${method} request failed`, null, null, error);
  }

  const body = asObject(await response.json().catch(() => null));
  const lastfmCode = asNumber(body?.error);
  if (lastfmCode !== null) {
    throw new LastfmError(asText(body?.message) ?? `Last.fm error ${lastfmCode}`, lastfmCode, response.status);
  }
  if (!response.ok || !body) {
    throw new LastfmError(`Last.fm ${method} returned HTTP ${response.status}`, null, response.status);
  }
  return body;
}

function isNotFound(error: unknown): boolean {
  return error instanceof LastfmError && error.lastfmCode === lastfmNotFound;
}

/** Search songs by name for the seed picker. Last.fm search results have no durations. */
export async function searchTracks(query: string, limit = 10): Promise<Track[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) return [];

  const body = await callLastfm("track.search", { track: trimmedQuery, limit: String(limit) });
  const rawTracks = asArray(asObject(asObject(body.results)?.trackmatches)?.track);

  const tracks: Track[] = [];
  const seenKeys = new Set<string>();
  for (const rawTrack of rawTracks) {
    const trackObject = asObject(rawTrack);
    const title = asText(trackObject?.name);
    const artist = asText(trackObject?.artist);
    if (!title || !artist) continue;

    const trackKey = makeTrackKey(artist, title);
    if (seenKeys.has(trackKey)) continue;
    seenKeys.add(trackKey);

    tracks.push({ trackKey, artist, title, durationSeconds: null, imageUrl: pickImageUrl(trackObject?.image) });
  }
  return tracks;
}

/** Songs similar to the given one, based on Last.fm listening data. Empty if Last.fm doesn't know the song. */
export async function getSimilarTracks(artist: string, title: string, limit = 50): Promise<SimilarTrack[]> {
  let body: JsonObject;
  try {
    body = await callLastfm("track.getSimilar", { artist, track: title, limit: String(limit), autocorrect: "1" });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const rawTracks = asArray(asObject(body.similartracks)?.track);
  const tracks: SimilarTrack[] = [];
  const seenKeys = new Set<string>();
  for (const rawTrack of rawTracks) {
    const trackObject = asObject(rawTrack);
    const similarTitle = asText(trackObject?.name);
    const similarArtist = asText(asObject(trackObject?.artist)?.name);
    const match = asNumber(trackObject?.match);
    if (!similarTitle || !similarArtist || match === null) continue;

    const trackKey = makeTrackKey(similarArtist, similarTitle);
    if (seenKeys.has(trackKey)) continue;
    seenKeys.add(trackKey);

    tracks.push({
      trackKey,
      artist: similarArtist,
      title: similarTitle,
      durationSeconds: positiveSecondsOrNull(asNumber(trackObject?.duration)),
      imageUrl: pickImageUrl(trackObject?.image),
      match: Math.min(Math.max(match, 0), 1),
    });
  }
  return tracks;
}

/** Full details for one song, including duration and album art. Null if Last.fm doesn't know it. */
export async function getTrackInfo(artist: string, title: string): Promise<Track | null> {
  let body: JsonObject;
  try {
    body = await callLastfm("track.getInfo", { artist, track: title, autocorrect: "1" });
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }

  const trackObject = asObject(body.track);
  const infoTitle = asText(trackObject?.name);
  const infoArtist = asText(asObject(trackObject?.artist)?.name);
  if (!infoTitle || !infoArtist) return null;

  const durationMs = asNumber(trackObject?.duration);
  return {
    trackKey: makeTrackKey(infoArtist, infoTitle),
    artist: infoArtist,
    title: infoTitle,
    durationSeconds: positiveSecondsOrNull(durationMs === null ? null : durationMs / 1000),
    imageUrl: pickImageUrl(asObject(trackObject?.album)?.image),
  };
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSimilarTracks, getTrackInfo, LastfmError, searchTracks } from "./lastfm";

const placeholderImage = "https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png";

function mockLastfmResponse(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("LASTFM_API_KEY", "testKey");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("getSimilarTracks", () => {
  it("parses tracks, clamps scores and skips placeholder images and duplicates", async () => {
    const fetchMock = mockLastfmResponse({
      similartracks: {
        track: [
          {
            name: "Digital Love",
            artist: { name: "Daft Punk" },
            match: 1,
            duration: 301,
            image: [
              { "#text": "https://img.example/small.png", size: "small" },
              { "#text": "https://img.example/large.png", size: "large" },
            ],
          },
          { name: "Music Sounds Better With You", artist: { name: "Stardust" }, match: "0.82", duration: 0, image: [{ "#text": placeholderImage }] },
          { name: "digital love!", artist: { name: "DAFT PUNK" }, match: 0.5 },
          { name: "Missing artist", match: 0.4 },
          { name: "Too high", artist: { name: "X" }, match: 3 },
        ],
      },
    });

    const tracks = await getSimilarTracks("Daft Punk", "One More Time");

    expect(tracks.map((track) => track.title)).toEqual(["Digital Love", "Music Sounds Better With You", "Too high"]);
    expect(tracks[0]).toMatchObject({ durationSeconds: 301, imageUrl: "https://img.example/large.png", match: 1 });
    expect(tracks[1]).toMatchObject({ durationSeconds: null, imageUrl: null, match: 0.82 });
    expect(tracks[2].match).toBe(1);

    const requestUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(requestUrl.searchParams.get("method")).toBe("track.getSimilar");
    expect(requestUrl.searchParams.get("api_key")).toBe("testKey");
    expect(requestUrl.searchParams.get("track")).toBe("One More Time");
  });

  it("handles a single result returned as an object instead of an array", async () => {
    mockLastfmResponse({ similartracks: { track: { name: "Only One", artist: { name: "Solo" }, match: 0.7 } } });
    const tracks = await getSimilarTracks("A", "B");
    expect(tracks).toHaveLength(1);
  });

  it("returns an empty list when Last.fm doesn't know the song", async () => {
    mockLastfmResponse({ error: 6, message: "Track not found" });
    await expect(getSimilarTracks("Nobody", "Nothing")).resolves.toEqual([]);
  });

  it("throws LastfmError for other Last.fm errors", async () => {
    mockLastfmResponse({ error: 29, message: "Rate limit exceeded" }, 429);
    await expect(getSimilarTracks("A", "B")).rejects.toMatchObject({
      name: "LastfmError",
      lastfmCode: 29,
      httpStatus: 429,
    });
  });

  it("throws LastfmError when the request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    await expect(getSimilarTracks("A", "B")).rejects.toBeInstanceOf(LastfmError);
  });

  it("throws when the API key is missing", async () => {
    vi.stubEnv("LASTFM_API_KEY", "");
    await expect(getSimilarTracks("A", "B")).rejects.toThrow("LASTFM_API_KEY is not set");
  });
});

describe("searchTracks", () => {
  it("returns tracks with the artist as a string", async () => {
    mockLastfmResponse({
      results: { trackmatches: { track: [{ name: "Believe", artist: "Cher", image: [] }] } },
    });
    const tracks = await searchTracks("believe");
    expect(tracks).toEqual([
      { trackKey: "cher::believe", artist: "Cher", title: "Believe", durationSeconds: null, imageUrl: null },
    ]);
  });

  it("skips the request for an empty query", async () => {
    const fetchMock = mockLastfmResponse({});
    await expect(searchTracks("   ")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getTrackInfo", () => {
  it("converts duration from milliseconds and uses album art", async () => {
    mockLastfmResponse({
      track: {
        name: "Believe",
        duration: "239000",
        artist: { name: "Cher" },
        album: { image: [{ "#text": "https://img.example/album.png" }] },
      },
    });
    await expect(getTrackInfo("cher", "believe")).resolves.toMatchObject({
      durationSeconds: 239,
      imageUrl: "https://img.example/album.png",
    });
  });

  it("returns null when the song isn't found", async () => {
    mockLastfmResponse({ error: 6, message: "Track not found" });
    await expect(getTrackInfo("A", "B")).resolves.toBeNull();
  });
});

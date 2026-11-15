import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "@/test/pgliteDb";

import { getAlbumArtUrl, type ArtFinder } from "./albumArt";
import type { Db } from "./dbTypes";
import { DeezerError } from "./deezer";

let db: Db & { close: () => Promise<void> };

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
});

const coverUrl = "https://cdn-images.dzcdn.net/images/cover/abc/250x250-000000-80-0-0.jpg";

describe("getAlbumArtUrl", () => {
  it("looks up a cover once and serves it from the cache afterwards", async () => {
    const findArt = vi.fn<ArtFinder>().mockResolvedValue(coverUrl);

    await expect(getAlbumArtUrl(db, findArt, "Cher", "Believe")).resolves.toBe(coverUrl);
    await expect(getAlbumArtUrl(db, findArt, "CHER", "believe!")).resolves.toBe(coverUrl);

    expect(findArt).toHaveBeenCalledTimes(1);
  });

  it("remembers songs with no cover so they aren't searched again", async () => {
    const findArt = vi.fn<ArtFinder>().mockResolvedValue(null);

    await expect(getAlbumArtUrl(db, findArt, "Unknown", "Song")).resolves.toBeNull();
    await expect(getAlbumArtUrl(db, findArt, "Unknown", "Song")).resolves.toBeNull();

    expect(findArt).toHaveBeenCalledTimes(1);
  });

  it("searches again once a missing cover is older than the retry window", async () => {
    const findArt = vi.fn<ArtFinder>().mockResolvedValueOnce(null).mockResolvedValueOnce(coverUrl);
    await getAlbumArtUrl(db, findArt, "Unknown", "Song");
    await db.query("update track_cache set art_checked_at = now() - interval '31 days'");

    await expect(getAlbumArtUrl(db, findArt, "Unknown", "Song")).resolves.toBe(coverUrl);
  });

  it("doesn't cache failures", async () => {
    const findArt = vi.fn<ArtFinder>().mockRejectedValueOnce(new DeezerError("rate limited")).mockResolvedValueOnce(coverUrl);

    await expect(getAlbumArtUrl(db, findArt, "Cher", "Believe")).rejects.toBeInstanceOf(DeezerError);
    await expect(getAlbumArtUrl(db, findArt, "Cher", "Believe")).resolves.toBe(coverUrl);
  });

  it("keeps the similar-tracks cache for the same song intact", async () => {
    await db.query(
      `insert into track_cache (track_key, artist, title, similar_tracks, similar_fetched_at)
       values ('cher::believe', 'Cher', 'Believe', '[]'::jsonb, now())`,
    );
    await getAlbumArtUrl(db, vi.fn<ArtFinder>().mockResolvedValue(coverUrl), "Cher", "Believe");

    const rows = await db.query<{ image_url: string; similar_tracks: unknown }>(
      "select image_url, similar_tracks from track_cache where track_key = 'cher::believe'",
    );
    expect(rows[0]).toEqual({ image_url: coverUrl, similar_tracks: [] });
  });
});

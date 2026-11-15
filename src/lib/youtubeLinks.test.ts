import { describe, expect, it, vi } from "vitest";

import {
  buildWatchVideosUrl,
  buildYoutubeMusicUrl,
  extractTemporaryPlaylistId,
  fetchTemporaryPlaylistId,
  maxVideosPerLink,
  shuffled,
} from "./youtubeLinks";

describe("buildWatchVideosUrl", () => {
  it("joins video IDs and caps them at the link limit", () => {
    const videoIds = Array.from({ length: 60 }, (_, index) => `video${String(index).padStart(6, "0")}`);
    const url = new URL(buildWatchVideosUrl(videoIds));
    expect(url.origin + url.pathname).toBe("https://www.youtube.com/watch_videos");
    expect(url.searchParams.get("video_ids")?.split(",")).toHaveLength(maxVideosPerLink);
  });
});

describe("shuffled", () => {
  it("returns a new array with the same items", () => {
    const items = [1, 2, 3, 4, 5];
    const result = shuffled(items, () => 0);
    expect(result).not.toBe(items);
    expect([...result].sort()).toEqual(items);
    expect(result).not.toEqual(items);
  });
});

describe("extractTemporaryPlaylistId", () => {
  it("reads TL playlist IDs from absolute and relative redirect URLs", () => {
    expect(extractTemporaryPlaylistId("https://www.youtube.com/watch?v=abc&list=TLGGx1_y-2")).toBe("TLGGx1_y-2");
    expect(extractTemporaryPlaylistId("/watch?v=abc&list=TLGGzz")).toBe("TLGGzz");
  });

  it("ignores anything that isn't a temporary playlist", () => {
    expect(extractTemporaryPlaylistId("https://consent.youtube.com/m?continue=x")).toBeNull();
    expect(extractTemporaryPlaylistId("https://www.youtube.com/watch?list=PL123")).toBeNull();
    expect(extractTemporaryPlaylistId("https://www.youtube.com/watch?list=TL<script>")).toBeNull();
  });
});

describe("buildYoutubeMusicUrl", () => {
  it("points at music.youtube.com with the first video and the list", () => {
    expect(buildYoutubeMusicUrl("abcdefghijk", "TLGG1")).toBe("https://music.youtube.com/watch?v=abcdefghijk&list=TLGG1");
  });
});

describe("fetchTemporaryPlaylistId", () => {
  it("returns the list from YouTube's redirect without following it", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 303, headers: { location: "/watch?v=a&list=TLGGok" } }),
    );
    await expect(fetchTemporaryPlaylistId("https://www.youtube.com/watch_videos?video_ids=a", fetchMock)).resolves.toBe(
      "TLGGok",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("returns null when the request fails or doesn't redirect", async () => {
    await expect(fetchTemporaryPlaylistId("https://x", vi.fn<typeof fetch>().mockRejectedValue(new Error("down")))).resolves.toBeNull();
    await expect(
      fetchTemporaryPlaylistId("https://x", vi.fn<typeof fetch>().mockResolvedValue(new Response("page"))),
    ).resolves.toBeNull();
  });
});

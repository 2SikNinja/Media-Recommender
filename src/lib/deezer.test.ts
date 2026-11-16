import { describe, expect, it, vi } from "vitest";

import { DeezerError, findAlbumArt, findPreviewUrl, isDeezerCdnUrl, previewCacheSeconds } from "./deezer";

const cover = (name: string) => `https://cdn-images.dzcdn.net/images/cover/${name}/250x250-000000-80-0-0.jpg`;

function deezerResponse(data: unknown[]) {
  return Response.json({ data, total: data.length });
}

describe("findAlbumArt", () => {
  it("returns the cover of the result by the same artist and title", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      deezerResponse([
        { title: "Believe (Cover)", artist: { name: "Some Karaoke Band" }, album: { cover_medium: cover("karaoke") } },
        { title: "Strong Enough", artist: { name: "Cher" }, album: { cover_medium: cover("strong") } },
        { title: "Believe", artist: { name: "Cher" }, album: { cover_medium: cover("believe") } },
      ]),
    );

    await expect(findAlbumArt("Cher", "Believe", fetchMock)).resolves.toBe(cover("believe"));
    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.searchParams.get("q")).toBe('artist:"Cher" track:"Believe"');
  });

  it("falls back to a plain search when the exact search finds nothing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(deezerResponse([]))
      .mockResolvedValueOnce(
        deezerResponse([{ title: "Victory Lap", artist: { name: "Fred again.." }, album: { cover_medium: cover("lap") } }]),
      );

    await expect(findAlbumArt("Fred again..", "Victory Lap", fetchMock)).resolves.toBe(cover("lap"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null instead of another artist's cover", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        deezerResponse([{ title: "Believe", artist: { name: "Someone Else" }, album: { cover_medium: cover("x") } }]),
      );
    await expect(findAlbumArt("Cher", "Believe", fetchMock)).resolves.toBeNull();
  });

  it("ignores cover URLs that aren't on Deezer's image servers", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        deezerResponse([{ title: "Believe", artist: { name: "Cher" }, album: { cover_medium: "https://evil.example/x.jpg" } }]),
      );
    await expect(findAlbumArt("Cher", "Believe", fetchMock)).resolves.toBeNull();
  });

  it("throws DeezerError for rate limits, which Deezer reports with HTTP 200", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: { type: "Exception", message: "Quota limit exceeded", code: 4 } }));
    await expect(findAlbumArt("Cher", "Believe", fetchMock)).rejects.toBeInstanceOf(DeezerError);
  });

  it("throws DeezerError when the request fails", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network down"));
    await expect(findAlbumArt("Cher", "Believe", fetchMock)).rejects.toBeInstanceOf(DeezerError);
  });
});

describe("isDeezerCdnUrl", () => {
  it("only accepts https URLs on dzcdn.net", () => {
    expect(isDeezerCdnUrl(cover("a"))).toBe(true);
    expect(isDeezerCdnUrl("https://e-cdns-images.dzcdn.net/images/cover/a/250x250.jpg")).toBe(true);
    expect(isDeezerCdnUrl("http://cdn-images.dzcdn.net/a.jpg")).toBe(false);
    expect(isDeezerCdnUrl("https://dzcdn.net.evil.example/a.jpg")).toBe(false);
    expect(isDeezerCdnUrl("javascript:alert(1)")).toBe(false);
    expect(isDeezerCdnUrl(null)).toBe(false);
  });
});

const preview = (id: string, expiry = 1_900_000_000) =>
  `https://cdnt-preview.dzcdn.net/api/1/1/a/b/c/0/${id}.mp3?hdnea=exp=${expiry}~acl=/api/1/1/a/b/c/0/${id}.mp3*~data=user_id=0~hmac=abc`;

describe("findPreviewUrl", () => {
  it("returns the preview of the same song by the same artist", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      deezerResponse([
        { title: "Strong Enough", artist: { name: "Cher" }, preview: preview("strong") },
        { title: "Believe", artist: { name: "Cher" }, preview: preview("believe") },
      ]),
    );
    await expect(findPreviewUrl("Cher", "Believe", fetchMock)).resolves.toBe(preview("believe"));
  });

  it("returns null instead of a different song by the same artist", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => deezerResponse([{ title: "Strong Enough", artist: { name: "Cher" }, preview: preview("strong") }]));
    await expect(findPreviewUrl("Cher", "Believe", fetchMock)).resolves.toBeNull();
  });

  it("skips results with no preview or a preview off Deezer's servers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      deezerResponse([
        { title: "Believe", artist: { name: "Cher" }, preview: "" },
        { title: "Believe", artist: { name: "Cher" }, preview: "https://evil.example/x.mp3" },
      ]),
    );
    await expect(findPreviewUrl("Cher", "Believe", fetchMock)).resolves.toBeNull();
  });

  it("falls back to a plain search when the exact search finds nothing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(deezerResponse([]))
      .mockResolvedValueOnce(deezerResponse([{ title: "Victory Lap", artist: { name: "Fred again.." }, preview: preview("lap") }]));
    await expect(findPreviewUrl("Fred again..", "Victory Lap", fetchMock)).resolves.toBe(preview("lap"));
  });
});

describe("previewCacheSeconds", () => {
  const nowMs = 1_800_000_000_000;

  it("caches until a minute before the signed URL expires", () => {
    expect(previewCacheSeconds(preview("a", 1_800_000_000 + 600), nowMs)).toBe(540);
  });

  it("caps the cache at an hour", () => {
    expect(previewCacheSeconds(preview("a", 1_800_000_000 + 86_400), nowMs)).toBe(3_600);
  });

  it("returns 0 for URLs that are about to expire or already have", () => {
    expect(previewCacheSeconds(preview("a", 1_800_000_000 + 30), nowMs)).toBe(0);
    expect(previewCacheSeconds(preview("a", 1_700_000_000), nowMs)).toBe(0);
  });

  it("uses a short default when the URL has no expiry", () => {
    expect(previewCacheSeconds("https://cdnt-preview.dzcdn.net/a.mp3", nowMs)).toBe(300);
  });
});

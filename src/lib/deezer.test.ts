import { describe, expect, it, vi } from "vitest";

import { DeezerError, findAlbumArt, isDeezerImageUrl } from "./deezer";

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

describe("isDeezerImageUrl", () => {
  it("only accepts https URLs on dzcdn.net", () => {
    expect(isDeezerImageUrl(cover("a"))).toBe(true);
    expect(isDeezerImageUrl("https://e-cdns-images.dzcdn.net/images/cover/a/250x250.jpg")).toBe(true);
    expect(isDeezerImageUrl("http://cdn-images.dzcdn.net/a.jpg")).toBe(false);
    expect(isDeezerImageUrl("https://dzcdn.net.evil.example/a.jpg")).toBe(false);
    expect(isDeezerImageUrl("javascript:alert(1)")).toBe(false);
    expect(isDeezerImageUrl(null)).toBe(false);
  });
});

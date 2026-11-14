import { describe, expect, it, vi } from "vitest";

import { createResolverClient, ResolverError, type ResolveQuery } from "./resolverClient";

function makeQueries(count: number): ResolveQuery[] {
  return Array.from({ length: count }, (_, index) => ({ artist: "Artist", title: `Song ${index}`, durationSeconds: 200 }));
}

/** Pretend resolver that matches every song it is sent. */
function okFetch() {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const { tracks } = JSON.parse(String(init?.body)) as { tracks: Array<{ artist: string; title: string }> };
    return Response.json({
      results: tracks.map((track) => ({
        ...track,
        videoId: "abcdefghijk",
        source: "ytmusicSongs",
        confidence: 0.9,
        error: null,
      })),
      resolvedCount: tracks.length,
      unresolvedCount: 0,
    });
  });
}

describe("createResolverClient", () => {
  it("sends the secret and splits large requests into batches of 50", async () => {
    const fetchMock = okFetch();
    const resolver = createResolverClient({ url: "https://resolver.example", secret: "s3cret", fetchImpl: fetchMock });

    const results = await resolver(makeQueries(120));

    expect(results).toHaveLength(120);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://resolver.example/resolve");
    expect((init?.headers as Record<string, string>)["x-resolver-secret"]).toBe("s3cret");
    expect(JSON.parse(String(init?.body)).tracks).toHaveLength(50);
  });

  it("throws ResolverError on HTTP errors, network errors and malformed responses", async () => {
    const cases = [
      vi.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 401 })),
      vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network down")),
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [{ videoId: "not valid" }] })),
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [] })),
    ];
    for (const fetchMock of cases) {
      const resolver = createResolverClient({ url: "https://resolver.example", secret: "s", fetchImpl: fetchMock });
      await expect(resolver(makeQueries(1))).rejects.toBeInstanceOf(ResolverError);
    }
  });
});

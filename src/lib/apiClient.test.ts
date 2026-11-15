import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, createSession, errorMessage, searchTracks, submitPick } from "./apiClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("apiClient", () => {
  it("sends JSON bodies and returns parsed responses", async () => {
    const fetchMock = stubFetch(Response.json({ sessionId: "abc" }, { status: 201 }));

    await expect(createSession({ artist: "Cher", title: "Believe" })).resolves.toEqual({ sessionId: "abc" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sessions");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ artist: "Cher", title: "Believe" });
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("encodes search queries and path segments", async () => {
    const fetchMock = stubFetch(Response.json({ tracks: [] }));
    await searchTracks("AC/DC & friends");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tracks/search?q=AC%2FDC%20%26%20friends");

    stubFetch(Response.json({}));
    await submitPick("a/b", 1, "x::y");
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/sessions/a%2Fb/picks");
  });

  it("turns API errors into ApiClientError with the server's message", async () => {
    stubFetch(Response.json({ error: { code: "conflict", message: "You already picked a song for round 1." } }, { status: 409 }));
    const error = await submitPick("s", 1, "x::y").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ code: "conflict", status: 409 });
    expect(errorMessage(error)).toBe("You already picked a song for round 1.");
  });

  it("gives a clear message for network failures and non-JSON errors", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    expect(errorMessage(await searchTracks("x").catch((caught: unknown) => caught))).toBe(
      "Couldn't reach Pickify. Check your connection and try again.",
    );

    stubFetch(new Response("<html>Bad gateway</html>", { status: 502 }));
    expect(errorMessage(await searchTracks("x").catch((caught: unknown) => caught))).toBe(
      "Something went wrong on our end. Try again.",
    );
  });

  it("lets aborted searches through as aborts, not errors", async () => {
    stubFetch(new DOMException("The operation was aborted.", "AbortError"));
    await expect(searchTracks("x")).rejects.toMatchObject({ name: "AbortError" });
  });
});

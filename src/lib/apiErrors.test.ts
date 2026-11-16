import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, readJsonBody, toErrorResponse } from "./apiErrors";
import { createSessionSchema } from "./apiSchemas";
import { LastfmError } from "./lastfm";

afterEach(() => {
  vi.restoreAllMocks();
});

async function readError(response: Response) {
  return { status: response.status, body: await response.json() };
}

describe("toErrorResponse", () => {
  it("passes ApiError codes and messages through", async () => {
    const result = await readError(toErrorResponse(new ApiError("conflict", "Already picked."), "test"));
    expect(result).toEqual({ status: 409, body: { error: { code: "conflict", message: "Already picked." } } });
  });

  it("turns validation errors into a 400 that names the field", async () => {
    const parsed = createSessionSchema.safeParse({ artist: "", title: "Believe" });
    const result = await readError(toErrorResponse(parsed.error, "test"));
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("invalidRequest");
    expect(result.body.error.message).toContain("artist");
  });

  it("hides Last.fm and unexpected error details from the response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const lastfm = await readError(toErrorResponse(new LastfmError("Invalid API key secret123", 10, 403), "test"));
    expect(lastfm.status).toBe(503);
    expect(JSON.stringify(lastfm.body)).not.toContain("secret123");

    const unexpected = await readError(toErrorResponse(new Error("password=hunter2 connection failed"), "test"));
    expect(unexpected).toEqual({
      status: 500,
      body: { error: { code: "internalError", message: "Something went wrong on our end. Try again." } },
    });
  });
});

describe("readJsonBody", () => {
  it("rejects bodies that aren't JSON", async () => {
    const request = new Request("https://pickify.test", { method: "POST", body: "not json" });
    await expect(readJsonBody(request)).rejects.toMatchObject({ code: "invalidRequest" });
  });
});

describe("rate limit responses", () => {
  it("sends 429 with Retry-After", async () => {
    const response = toErrorResponse(new ApiError("rateLimited", "Slow down.", { retryAfterSeconds: 12 }), "test");
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(await response.json()).toEqual({ error: { code: "rateLimited", message: "Slow down." } });
  });
});

describe("alerts from error responses", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_ALERT_WEBHOOK_URL", "https://discord.test/api/webhooks/1/abc");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("alerts on unexpected errors", async () => {
    toErrorResponse(new Error("database exploded"), "GET /api/alertTest");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).embeds[0].title).toBe("Unexpected server error");
  });

  it("alerts when Last.fm is down, but not when it just doesn't know a song", async () => {
    toErrorResponse(new LastfmError("Track not found", 6, 200), "GET /api/alertTest2");
    toErrorResponse(new ApiError("notFound", "No such playlist."), "GET /api/alertTest2");
    expect(fetchMock).not.toHaveBeenCalled();
    toErrorResponse(new LastfmError("Service Temporarily Unavailable", 16, 503), "GET /api/alertTest2");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});

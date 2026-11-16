import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describeError, discordMessage, reportProblem, shouldSend } from "./alerts";

describe("shouldSend", () => {
  it("mutes the same problem for 10 minutes, but not different ones", () => {
    const start = 1_000_000_000;
    expect(shouldSend("muteTest:a", start)).toBe(true);
    expect(shouldSend("muteTest:a", start + 60_000)).toBe(false);
    expect(shouldSend("muteTest:b", start + 60_000)).toBe(true);
    expect(shouldSend("muteTest:a", start + 10 * 60_000 + 1)).toBe(true);
  });
});

describe("discordMessage", () => {
  it("includes the title, the detail as a code block, where it happened and the deployment", () => {
    const message = discordMessage(
      { key: "k", title: "Unexpected server error", detail: "TypeError: boom", where: "POST /api/sessions" },
      { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_SHA: "70f5b40595aea772" },
    );
    expect(message.embeds[0]).toMatchObject({
      title: "Unexpected server error",
      description: "```\nTypeError: boom\n```",
      fields: [
        { name: "Where", value: "POST /api/sessions" },
        { name: "Environment", value: "production" },
        { name: "Commit", value: "70f5b40" },
      ],
    });
  });

  it("keeps long details within Discord's limits", () => {
    const message = discordMessage({ key: "k", title: "x".repeat(400), detail: "y".repeat(5000) }, {});
    expect(message.embeds[0].title).toHaveLength(250);
    expect(message.embeds[0].description?.length).toBeLessThan(1600);
  });
});

describe("reportProblem", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("does nothing without a webhook set", () => {
    vi.stubEnv("DISCORD_ALERT_WEBHOOK_URL", "");
    reportProblem({ key: "report:none", title: "t" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the webhook once per problem", async () => {
    vi.stubEnv("DISCORD_ALERT_WEBHOOK_URL", "https://discord.test/api/webhooks/1/abc");
    reportProblem({ key: "report:once", title: "Down" });
    reportProblem({ key: "report:once", title: "Down" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.test/api/webhooks/1/abc");
    expect(JSON.parse(String(init?.body)).embeds[0].title).toBe("Down");
  });

  it("never throws when Discord can't be reached", async () => {
    vi.stubEnv("DISCORD_ALERT_WEBHOOK_URL", "https://discord.test/api/webhooks/1/abc");
    fetchMock.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => reportProblem({ key: "report:offline", title: "t" })).not.toThrow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});

describe("describeError", () => {
  it("gives the type, message and top of the stack", () => {
    expect(describeError(new TypeError("bad"))).toMatch(/^TypeError: bad\n\s+at /);
    expect(describeError("plain")).toBe("plain");
  });
});

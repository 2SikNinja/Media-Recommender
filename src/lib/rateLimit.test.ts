import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDb } from "@/test/pgliteDb";

import { ApiError } from "./apiErrors";
import type { Db } from "./dbTypes";
import { clientKeyFor, enforceRateLimit, rateLimits } from "./rateLimit";

let db: Db & { close: () => Promise<void> };

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
});

function requestFrom(ip: string) {
  return new Request("https://pickify.test/api/sessions", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
}

const noCleanup = () => 1;
const start = new Date("2026-11-15T12:00:05Z");

async function hit(ip: string, bucket: keyof typeof rateLimits, now = start) {
  return enforceRateLimit(db, requestFrom(ip), bucket, { now, random: noCleanup });
}

describe("enforceRateLimit", () => {
  it("allows requests up to the limit, then refuses with when to retry", async () => {
    const { limit } = rateLimits.createSession;
    for (let index = 0; index < limit; index += 1) await hit("1.1.1.1", "createSession");

    const error = await hit("1.1.1.1", "createSession").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "rateLimited", retryAfterSeconds: 55 });
  });

  it("counts each client and each kind of request separately", async () => {
    const { limit } = rateLimits.createSession;
    for (let index = 0; index < limit; index += 1) await hit("1.1.1.1", "createSession");
    await expect(hit("2.2.2.2", "createSession")).resolves.toBeUndefined();
    await expect(hit("1.1.1.1", "search")).resolves.toBeUndefined();
  });

  it("starts counting again in the next window", async () => {
    const { limit } = rateLimits.createSession;
    for (let index = 0; index <= limit; index += 1) await hit("1.1.1.1", "createSession").catch(() => {});
    await expect(hit("1.1.1.1", "createSession", new Date("2026-11-15T12:01:00Z"))).resolves.toBeUndefined();
  });

  it("deletes windows older than an hour when cleaning up", async () => {
    await hit("1.1.1.1", "search", new Date("2026-11-15T10:00:00Z"));
    await enforceRateLimit(db, requestFrom("1.1.1.1"), "search", { now: start, random: () => 0 });
    const rows = await db.query<{ window_start: Date }>("select window_start from rate_limit_hits");
    expect(rows).toHaveLength(1);
  });

  it("allows the request when the database can't be reached", async () => {
    const brokenDb: Db = { query: vi.fn().mockRejectedValue(new Error("down")), transaction: vi.fn() };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(enforceRateLimit(brokenDb, requestFrom("1.1.1.1"), "search")).resolves.toBeUndefined();
  });
});

describe("clientKeyFor", () => {
  it("uses the first forwarded address and never stores it as-is", () => {
    const key = clientKeyFor(requestFrom("203.0.113.9"));
    expect(key).toBe(clientKeyFor(new Request("https://x", { headers: { "x-forwarded-for": "203.0.113.9" } })));
    expect(key).not.toContain("203.0.113.9");
    expect(key).not.toBe(clientKeyFor(requestFrom("203.0.113.10")));
  });
});

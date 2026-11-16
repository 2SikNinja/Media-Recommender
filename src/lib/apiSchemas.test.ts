import { describe, expect, it } from "vitest";

import { createSessionSchema } from "./apiSchemas";

describe("createSessionSchema", () => {
  it("fills in the default rounds and playlist length", () => {
    expect(createSessionSchema.parse({ seeds: [{ artist: "M83", title: "Midnight City" }] })).toEqual({
      seeds: [{ artist: "M83", title: "Midnight City" }],
      rounds: 5,
      playlistSize: 50,
    });
  });

  it("still accepts the older one-song body", () => {
    expect(createSessionSchema.parse({ artist: " M83 ", title: "Midnight City" }).seeds).toEqual([
      { artist: "M83", title: "Midnight City" },
    ]);
  });

  it("accepts up to three seeds and the listed lengths only", () => {
    const seed = { artist: "A", title: "B" };
    expect(createSessionSchema.parse({ seeds: [seed, seed, seed], rounds: 8, playlistSize: 100 }).rounds).toBe(8);
    expect(() => createSessionSchema.parse({ seeds: [seed, seed, seed, seed] })).toThrow();
    expect(() => createSessionSchema.parse({ seeds: [] })).toThrow();
    expect(() => createSessionSchema.parse({ seeds: [seed], rounds: 4 })).toThrow();
    expect(() => createSessionSchema.parse({ seeds: [seed], playlistSize: 1000 })).toThrow();
  });
});

import { describe, expect, it } from "vitest";

import { makeTrackKey, normalizeText } from "./tracks";

describe("normalizeText", () => {
  it("removes accents, punctuation and featured artists", () => {
    expect(normalizeText("Señorita (feat. Camila Cabello)")).toBe("senorita");
    expect(normalizeText("Don't Stop Me Now - Remastered 2011")).toBe("don t stop me now remastered 2011");
    expect(normalizeText("Old Town Road feat. Billy Ray Cyrus")).toBe("old town road");
  });

  it("keeps non-Latin scripts", () => {
    expect(normalizeText("밤양갱")).toBe("밤양갱".normalize("NFKD"));
    expect(normalizeText("夜に駆ける")).toBe("夜に駆ける".normalize("NFKD"));
  });

  it("does not cut words that only start with feat", () => {
    expect(normalizeText("Feather")).toBe("feather");
  });
});

describe("makeTrackKey", () => {
  it("treats differently formatted names as the same song", () => {
    expect(makeTrackKey("Daft Punk", "One More Time")).toBe(makeTrackKey("DAFT PUNK", "one more time!"));
  });

  it("separates artist and title so different splits don't collide", () => {
    expect(makeTrackKey("A B", "C")).not.toBe(makeTrackKey("A", "B C"));
  });
});

import { describe, expect, it } from "vitest";

import { reasonText } from "./reasonText";

describe("reasonText", () => {
  it("describes seeds and picks", () => {
    expect(reasonText({ kind: "seed" })).toBe("Your starting song");
    expect(reasonText({ kind: "pick" })).toBe("You picked this");
  });

  it("names the picks a song is similar to", () => {
    expect(
      reasonText({
        kind: "similar",
        to: [
          { artist: "Slander", title: "First Time", kind: "pick" },
          { artist: "Dabin", title: "Hollow", kind: "pick" },
        ],
      }),
    ).toBe("Because you picked First Time and Hollow");
  });

  it("says similar to when a seed is involved", () => {
    expect(reasonText({ kind: "similar", to: [{ artist: "Illenium", title: "Feel Something", kind: "seed" }] })).toBe(
      "Similar to Feel Something",
    );
  });

  it("is empty for older playlists", () => {
    expect(reasonText(null)).toBe("");
  });
});

import { describe, expect, it } from "vitest";

import { cardIndexForKey } from "./RoundShortcuts";

describe("cardIndexForKey", () => {
  it("maps 1 to 9 to the first nine cards and 0 to the tenth, on either number row or keypad", () => {
    expect(cardIndexForKey("Digit1")).toBe(0);
    expect(cardIndexForKey("Digit9")).toBe(8);
    expect(cardIndexForKey("Digit0")).toBe(9);
    expect(cardIndexForKey("Numpad4")).toBe(3);
  });

  it("ignores other keys", () => {
    expect(cardIndexForKey("KeyA")).toBeNull();
    expect(cardIndexForKey("Enter")).toBeNull();
  });
});

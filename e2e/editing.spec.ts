import { expect, test } from "./fixtures";
import { playlistId } from "./support/mockApi";

test.beforeEach(async ({ page }) => {
  await page.goto(`/playlist/${playlistId}`);
  await expect(page.locator("ol > li").first()).toBeVisible();
});

function songTitles(page: import("@playwright/test").Page) {
  return page.locator("ol > li span.font-medium").allInnerTexts();
}

test("drags a song to the top", async ({ page, api, isMobile }) => {
  test.skip(isMobile, "Touch dragging is covered by the keyboard test; this one uses a mouse.");
  const before = await songTitles(page);
  const third = page.locator("ol > li").nth(2);
  await third.hover();
  const handle = await third.getByRole("button", { name: /^Move / }).boundingBox();
  const firstRow = await page.locator("ol > li").first().boundingBox();
  if (!handle || !firstRow) throw new Error("Rows aren't on screen");

  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + 10, handle.y - 20, { steps: 5 });
  await page.mouse.move(handle.x + 10, firstRow.y + 5, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => songTitles(page)).toEqual([before[2], before[0], before[1], ...before.slice(3)]);
  const saved = api.calls.find((call) => call.path.endsWith("/order"));
  expect((saved?.body as { positions: number[] }).positions.slice(0, 3)).toEqual([3, 1, 2]);
});

test("moves a song with the keyboard", async ({ page }) => {
  const before = await songTitles(page);
  await page.locator("ol > li").first().getByRole("button", { name: /^Move / }).focus();
  // Each step waits for the screen reader announcement, which also checks it's said.
  await page.keyboard.press("Space");
  await expect(page.getByText(`${before[0]} by Seed Artist moved to spot 1.`)).toBeAttached();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByText(`${before[0]} by Seed Artist moved to spot 2.`)).toBeAttached();
  await page.keyboard.press("Space");

  await expect.poll(() => songTitles(page)).toEqual([before[1], before[0], ...before.slice(2)]);
});

test("adds a song from search to the end", async ({ page, api }) => {
  await page.getByRole("button", { name: "Add a song" }).click();
  await page.getByPlaceholder("Search for a song to add").fill("song");
  await page.getByRole("button", { name: "Add Song 1 by Artist B" }).click();

  await expect(page.getByText("Added Song 1 to the end.")).toBeVisible();
  const last = page.locator("ol > li").last();
  await expect(last).toContainText("Song 1");
  await expect(last).toContainText("You added this");
  expect(api.calls.some((call) => call.method === "POST" && call.path.endsWith("/tracks"))).toBe(true);
});

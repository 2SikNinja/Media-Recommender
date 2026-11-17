import { expect, test } from "./fixtures";
import { playlistId } from "./support/mockApi";

test.beforeEach(async ({ page }) => {
  await page.goto(`/playlist/${playlistId}`);
  await expect(page.getByRole("heading", { name: "Inspired by Seed Song" })).toBeVisible();
});

test("plays on the page and keeps the player in sync", async ({ page }) => {
  await page.getByRole("button", { name: "Play", exact: true }).first().click();
  const player = page.getByRole("region", { name: "Player" });
  await expect(player).toBeVisible();
  await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

  await player.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(player.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await player.getByRole("button", { name: "Next song" }).click();
  await expect(player.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
});

test("removes a song and puts it back with Undo", async ({ page, api }) => {
  const rows = page.locator("ol > li");
  const before = await rows.count();
  await page.getByRole("button", { name: "Remove Song 3 by Artist D" }).click();

  await expect(rows).toHaveCount(before - 1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rows).toHaveCount(before);
  expect(api.calls.filter((call) => call.method === "PATCH")).toHaveLength(2);
});

test("prepares the YouTube links as the page opens", async ({ page, api }) => {
  await expect.poll(() => api.calls.some((call) => call.path.endsWith("/export/youtube"))).toBe(true);
  await expect(page.getByRole("link", { name: /Open in YouTube Music/ })).toBeVisible();
});

test("says why a song is in the playlist", async ({ page }) => {
  await expect(page.locator("ol > li").first()).toContainText("Your starting song");
});

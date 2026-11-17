import { expect, test } from "./fixtures";
import { playlistId, seedSong } from "./support/mockApi";

test("goes from a seed song through every round to the playlist", async ({ page, api }) => {
  await page.goto("/");
  await page.getByRole("searchbox").fill("seed song");
  await page.getByRole("radio", { name: "Quick" }).click();
  await page.getByRole("radio", { name: "25 songs" }).click();
  await page.getByRole("button", { name: "Start here" }).first().click();

  await expect(page).toHaveURL(/\/session\//);
  await expect(page.getByText("Round 1 of 3")).toBeVisible();
  await expect(page.getByText(seedSong.title).first()).toBeVisible();
  const created = api.calls.find((call) => call.path === "/api/sessions" && call.method === "POST");
  expect(created?.body).toMatchObject({ rounds: 3, playlistSize: 25 });

  for (const round of [1, 2, 3]) {
    await expect(page.getByText(`Round ${round} of 3`)).toBeVisible();
    await page.getByRole("checkbox").nth(0).click();
    await page.getByRole("checkbox").nth(3).click();
    await expect(page.getByLabel("2 picked")).toBeVisible();
    await page.getByRole("button", { name: round === 3 ? /Build my playlist/ : /Next round/ }).click();
  }

  await expect(page).toHaveURL(new RegExp(`/playlist/${playlistId}`));
  await expect(page.getByRole("heading", { name: "Inspired by Seed Song" })).toBeVisible();
  const picks = api.calls.filter((call) => call.path.endsWith("/picks"));
  expect(picks).toHaveLength(3);
  expect((picks[0].body as { trackKeys: string[] }).trackKeys).toHaveLength(2);
});

test("None of these swaps the round and clears the picks", async ({ page, api }) => {
  await page.goto("/");
  await page.getByRole("searchbox").fill("seed song");
  await page.getByRole("button", { name: "Start here" }).first().click();
  await expect(page.getByText("Round 1 of 5")).toBeVisible();

  const firstTitle = await page.getByRole("checkbox").first().innerText();
  await page.getByRole("checkbox").first().click();
  await page.getByRole("button", { name: /None of these/ }).click();

  await expect(page.getByRole("checkbox").first()).not.toHaveText(firstTitle);
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
  expect(api.rerolls).toBe(1);
});

test("Not for me is sent with the pick", async ({ page, api }) => {
  await page.goto("/");
  await page.getByRole("searchbox").fill("seed song");
  await page.getByRole("button", { name: "Start here" }).first().click();
  await expect(page.getByText("Round 1 of 5")).toBeVisible();

  await page.getByRole("checkbox").nth(0).click();
  await page.getByRole("button", { name: /^Not for me:/ }).nth(1).click();
  await page.getByRole("button", { name: /Next round/ }).click();
  await expect(page.getByText("Round 2 of 5")).toBeVisible();

  const pick = api.calls.find((call) => call.path.endsWith("/picks"));
  expect((pick?.body as { dislikedKeys: string[] }).dislikedKeys).toHaveLength(1);
});

import { expect, test } from "./fixtures";
import { playlistId } from "./support/mockApi";

/** Nothing on the page should be wider than the screen. */
async function expectNoSideScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("pages fit the screen without scrolling sideways", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox").fill("seed song");
  await expect(page.getByRole("button", { name: "Start here" }).first()).toBeVisible();
  await expectNoSideScroll(page);

  await page.getByRole("button", { name: "Start here" }).first().click();
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  await expectNoSideScroll(page);

  await page.goto(`/playlist/${playlistId}`);
  await expect(page.locator("ol > li").first()).toBeVisible();
  await expectNoSideScroll(page);
});

test("the volume is remembered between visits", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones use their own volume buttons, so the slider is desktop only.");
  await page.goto("/");
  await page.getByLabel("Volume").fill("30");
  await page.reload();
  await expect(page.getByLabel("Volume")).toHaveValue("30");
});

import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { expect, test } from "../support/test.ts";

// 見つからない頁は、アプリの見た目のまま地図へ戻る道を示す
test.use({ viewport: { width: 390, height: 844 } });

test("見つからない頁から、地図の入口へ戻れる", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  const screen = page.getByTestId(testIds.status.screen);
  await expect(screen).toHaveAttribute("data-kind", "notFound");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("移動したか");
  await page.getByTestId(testIds.status.home).click();
  // 入口は「いまどこ」の問いから始まり、駅にいると答えると関西の地図に出る
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "position", {
    timeout: 30_000,
  });
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.positionStation).click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "kansai");
  await expect(page.getByTestId(testIds.start.prompt)).toBeVisible();
});

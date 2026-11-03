import { expect, test } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";

// 見つからない頁は、アプリの見た目のまま地図へ戻る道を示す
test.use({ viewport: { width: 390, height: 844 } });

test("見つからない頁から、地図の入口へ戻れる", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  const screen = page.getByTestId(testIds.status.screen);
  await expect(screen).toHaveAttribute("data-kind", "notFound");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("見つかりません");
  await page.getByTestId(testIds.status.home).click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "kansai", {
    timeout: 30_000,
  });
});

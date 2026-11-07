import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { expect, test } from "../support/test.ts";

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(90_000);

async function expectDepth(page: import("@playwright/test").Page, depth: number) {
  await expect.poll(() => page.evaluate(() => window.history.state?.entryDepth)).toBe(depth);
}

for (const back of ["device", "header"] as const) {
  test(`${back}: 判断から 1 回で再開見込みへ戻り、次の 1 回で経過へ戻る`, async ({ page }) => {
    await page.goto("/?mock=1");
    await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
      timeout: 30_000,
    });
    await page.getByTestId(testIds.start.positionStation).click();
    await page.getByTestId(testIds.start.hub("umeda")).click();
    await page.getByTestId(testIds.start.place("osaka")).click();
    await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
    await page.getByTestId(testIds.start.cause("person")).click();
    await page.getByTestId(testIds.start.elapsed("m10")).click();
    await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "resume");
    await expectDepth(page, 6);
    const entryHistoryLength = await page.evaluate(() => window.history.length);
    await page.getByTestId(testIds.start.resume("unknown")).click();
    await expect(page).toHaveURL(/\/judgment$/);
    await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });

    if (back === "device") await page.goBack();
    else await page.getByTestId(testIds.judgment.backButton).click();
    await expect(page).toHaveURL(/\/\?mock=1$/);
    await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "resume");
    await expectDepth(page, 6);
    await expect(page.getByTestId(testIds.start.answer("cause"))).toContainText("人身事故");
    await expect(page.getByTestId(testIds.start.answer("elapsed"))).toContainText("約10分");
    // 復元で入口の履歴を積み直すと、判断への進む履歴が消えて戻るが空振りする。
    expect(await page.evaluate(() => window.history.length)).toBe(entryHistoryLength + 1);
    await page.goBack();
    await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "elapsed");
    await expectDepth(page, 5);
    await expect(page).toHaveURL(/\/\?mock=1$/);
    await expect(page.getByTestId(testIds.start.answer("cause"))).toContainText("人身事故");

    await page.getByTestId(testIds.start.elapsed("m30")).click();
    await page.getByTestId(testIds.start.resume("unknown")).click();
    await expect(page).toHaveURL(/\/judgment$/);
    await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
    if (back === "device") await page.goBack();
    else await page.getByTestId(testIds.judgment.backButton).click();
    await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "resume");
    await expectDepth(page, 6);
    await expect(page.getByTestId(testIds.start.answer("elapsed"))).toContainText("30分以上");
    await page.goBack();
    await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "elapsed");
    await expectDepth(page, 5);
  });
}

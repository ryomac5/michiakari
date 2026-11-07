import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { expect, test } from "../support/test.ts";

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(90_000);

async function expectDepth(page: import("@playwright/test").Page, depth: number) {
  await expect.poll(() => page.evaluate(() => window.history.state?.entryDepth)).toBe(depth);
}

for (const back of ["device", "header"] as const) {
  test(`${back}: 判断から 1 回で行程の札へ戻り、判断は自動で始めず、次の 1 回で行き先へ戻る`, async ({
    page,
  }) => {
    await page.goto("/?mock=1");
    await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
      timeout: 30_000,
    });
    await page.getByTestId(testIds.start.positionStation).click();
    await page.getByTestId(testIds.start.hub("umeda")).click();
    await page.getByTestId(testIds.start.place("osaka")).click();
    await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute(
      "data-stage",
      "destination",
    );
    await expectDepth(page, 3);
    const entryHistoryLength = await page.evaluate(() => window.history.length);
    // 行き先を選ぶと、そのまま判断を始める
    await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
    await expect(page).toHaveURL(/\/judgment$/);
    await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });

    if (back === "device") await page.goBack();
    else await page.getByTestId(testIds.judgment.backButton).click();
    await expect(page).toHaveURL(/\/\?mock=1$/);
    await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "cause");
    await expectDepth(page, 4);
    await expect(page.getByTestId(testIds.start.editDestination)).toContainText("三ノ宮");
    await expect(page.getByTestId(testIds.start.judge)).toBeVisible();
    // 復元で入口の履歴を積み直すと、判断への進む履歴が消えて戻るが空振りする。
    expect(await page.evaluate(() => window.history.length)).toBe(entryHistoryLength + 2);
    // 戻っただけでは判断を始めない
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/\?mock=1$/);

    await page.goBack();
    await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute(
      "data-stage",
      "destination",
    );
    await expectDepth(page, 3);
    await expect(page).toHaveURL(/\/\?mock=1$/);

    await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
    await expect(page).toHaveURL(/\/judgment$/);
    await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
    if (back === "device") await page.goBack();
    else await page.getByTestId(testIds.judgment.backButton).click();
    await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "cause");
    await expectDepth(page, 4);
    // 行程の札の下のボタンで、同じ行程の判断を出し直せる
    await page.getByTestId(testIds.start.judge).click();
    await expect(page).toHaveURL(/\/judgment$/);
    await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
  });
}

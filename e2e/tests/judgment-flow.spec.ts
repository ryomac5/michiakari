/// <reference lib="dom" />
// page 内で動かす関数（addInitScript・evaluate）のために DOM の型を読む
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";

// モックの判断イベント（人身事故・終電間際の架空シナリオ）で、開始から判断までを通す
// 開発サーバーでは ?mock=1 で NEXT_PUBLIC_JUDGE_MOCK=1 と同じモックになる

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));
const reasoningOrder = ["reading", "signals", "phase", "options", "breakEven"];

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(120_000);

// 推論の各段が DOM に現れた順を記録する
async function recordReasoningSteps(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: string[] = [];
    Object.assign(window, { __reasoningLog: log });
    new MutationObserver(() => {
      for (const el of document.querySelectorAll("[data-testid^='judgment-reasoning-step-']")) {
        const id = el.getAttribute("data-testid") ?? "";
        if (!log.includes(id)) log.push(id);
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

// 表示の切り替えアニメーションが終わるのを待つ。回り続けるものは対象外
async function waitForFiniteAnimations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished),
    ),
  );
}

async function startWithPastedText(page: Page): Promise<void> {
  await page.goto("/?mock=1");
  await expect(page.getByTestId(testIds.app.mockBadge)).toBeVisible({ timeout: 30_000 });

  await page.getByTestId(testIds.start.originSearch).fill("大阪");
  await page.getByTestId(testIds.start.originOption("osaka")).click();
  await page.getByTestId(testIds.start.destinationSearch).fill("三ノ宮");
  await page.getByTestId(testIds.start.destinationOption("sannomiya")).click();
  await page.getByTestId(testIds.start.nextButton).click();

  await expect(page.getByTestId(testIds.situation.screen)).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(testIds.situation.tab("paste")).click();
  await page
    .getByTestId(testIds.situation.pasteInput)
    .fill("人身事故のため、運転を見合わせています。現在、現場の確認を行っています。");
  await page.getByTestId(testIds.situation.submit("paste")).click();
  await expect(page.getByTestId(testIds.judgment.screen)).toBeVisible({ timeout: 30_000 });
}

test("駅を選び、貼り付けで状況を入れると、推論過程が順に現れて結論と分岐点が出る", async ({
  page,
}) => {
  await recordReasoningSteps(page);
  await startWithPastedText(page);

  // 生成中は結論カードの位置に推論の過程が出る
  await expect(page.getByTestId(testIds.judgment.reasoning)).toBeVisible();
  for (const id of reasoningOrder) {
    await expect(page.getByTestId(testIds.judgment.reasoningStep(id))).toBeVisible();
  }

  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toBeVisible({ timeout: 15_000 });
  await expect(conclusion).toHaveAttribute("data-action", "wait");
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).not.toBeEmpty();
  await expect(page.getByTestId(testIds.judgment.reasoning)).toHaveCount(0);

  const log = await page.evaluate(
    () => (window as unknown as { __reasoningLog: string[] }).__reasoningLog,
  );
  expect(log).toEqual(reasoningOrder.map((id) => testIds.judgment.reasoningStep(id)));

  const breakEven = page.getByTestId(testIds.judgment.breakEven);
  await expect(breakEven).toBeVisible();
  await expect(page.getByTestId(testIds.judgment.breakEvenTime)).toHaveText(/^\d{2}:\d{2}$/);
  await expect(page.getByTestId(testIds.judgment.breakEvenCountdown)).toHaveText(/^\d+:\d{2}$/);

  const disclaimer = page.getByTestId(testIds.judgment.disclaimer);
  await expect(disclaimer).toBeVisible();
  await expect(disclaimer).toContainText("推定であり、公式発表を優先してください");

  await expect(page.getByTestId(testIds.judgment.map)).toBeVisible();
  await expect(page.getByTestId(testIds.judgment.option("transfer_hankyu"))).toBeVisible();
  await expect(page.getByTestId(testIds.judgment.option("transfer_hankyu"))).toContainText("—");

  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}judgment-390x844.png` });
  await page.screenshot({ path: `${screenshotDir}judgment-390x844-full.png`, fullPage: true });
});

test("情報を追加すると判断が更新され、根拠に段階と兆候が出る", async ({ page }) => {
  await startWithPastedText(page);
  await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
    "data-action",
    "wait",
    { timeout: 15_000 },
  );

  // 根拠は既定で閉じていて、開くと段階の「いまここ」と兆候が見える
  await expect(page.getByTestId(testIds.judgment.phaseTimeline)).toBeHidden();
  await page.getByTestId(testIds.judgment.evidenceToggle).click();
  await expect(page.getByTestId(testIds.judgment.phase("on_site"))).toHaveAttribute(
    "data-position",
    "current",
  );
  await expect(page.getByTestId(testIds.judgment.signal("site_check_announced"))).toBeVisible();

  const addInfo = page.getByTestId(testIds.judgment.addInfo);
  await addInfo.getByTestId(testIds.situation.tab("paste")).click();
  await addInfo.getByTestId(testIds.situation.pasteInput).fill("振替輸送を行っています。");
  await addInfo.getByTestId(testIds.situation.submit("paste")).click();

  await expect(page.getByTestId(testIds.judgment.reasoning)).toBeVisible();
  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toHaveAttribute("data-action", "switch", { timeout: 15_000 });
  await expect(page.getByTestId(testIds.judgment.breakEven)).toHaveAttribute(
    "data-state",
    "passed",
  );
  await expect(page.getByTestId(testIds.judgment.option("transfer_hankyu"))).toHaveAttribute(
    "data-recommended",
    "true",
  );
});

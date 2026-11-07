/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  loadReplayScenarios,
  openReplay,
  openSheet,
  waitForFiniteAnimations,
  waitForJudged,
} from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 分岐点の時間軸の振る舞い
// シナリオ ID と期待値はコードに書かず、YAML から選ぶ

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));
const scenarios = loadReplayScenarios();
// wait のあとに来る最初の switch の位置。発生直後から switch の段は、wait との比較に使えないので飛ばす
function findSwitchAfterWait(expectations: { action?: string }[]): number {
  const waitIndex = expectations.findIndex((e) => e.action === "wait");
  if (waitIndex < 0) return -1;
  return expectations.findIndex((e, i) => i > waitIndex && e.action === "switch");
}

// 主役のシナリオ: 期待値が wait から switch へ変わる最初のもの
const scenario = scenarios.find((s) => findSwitchAfterWait(s.expectations) >= 0);
const switchIndex = scenario ? findSwitchAfterWait(scenario.expectations) : -1;
const switchExpectation = scenario?.expectations[switchIndex];
// switch の直前にある wait の期待値
const waitExpectation = scenario?.expectations
  .slice(0, Math.max(switchIndex, 0))
  .findLast((e) => e.action === "wait");

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(180_000);

async function captureTop(page: Page, name: string): Promise<void> {
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}${name}-390x844.png` });
}

// 指定した観測まで 1 件ずつ進める
async function stepUntil(page: Page, observationId: string): Promise<void> {
  if (!scenario) throw new Error("シナリオがありません");
  const shown = await page.getByTestId(testIds.replay.judgment).getAttribute("data-observation-id");
  const start = scenario.timeline.findIndex((e) => e.id === shown) + 1;
  for (const entry of scenario.timeline.slice(start)) {
    await page.getByTestId(testIds.replay.nextButton).click();
    await waitForJudged(page, entry.id);
    if (entry.id === observationId) return;
  }
  throw new Error(`観測 ${observationId} まで進めませんでした`);
}

test("待つ判断では再開見込みの中央が分岐点より前、切り替える判断では後に描かれる", async ({
  page,
}) => {
  if (!scenario || !switchExpectation || !waitExpectation) {
    throw new Error("wait のあとに switch へ変わるシナリオがありません");
  }
  await openReplay(page, scenario.id);
  const timeline = page.getByTestId(testIds.judgment.breakEvenTimeline);
  const conclusion = page.getByTestId(testIds.judgment.conclusion);

  await stepUntil(page, waitExpectation.after);
  await expect(conclusion).toHaveAttribute("data-action", "wait");
  // 半分開くと再開見込みを 1 行で示し、全部開くと境目の見方に時間軸の全体が見える
  await openSheet(page, "half");
  await expect(page.getByTestId(testIds.judgment.breakEvenResume)).toBeInViewport();
  // 発表の時刻には延びる余地を持たせるので、帯が分岐点をまたぐこともある。中央は分岐点より前
  await expect(page.getByTestId(testIds.judgment.breakEvenResume)).toHaveAttribute(
    "data-relation",
    /^(before|straddle)$/,
  );
  await openSheet(page, "full");
  await timeline.scrollIntoViewIfNeeded();
  await expect(timeline).toBeInViewport();
  await expect(timeline).toHaveAttribute("data-relation", /^(before|straddle)$/);
  const [waitBreakEven, waitResumeP50] = await timeline.evaluate((el) => [
    Date.parse(el.getAttribute("data-break-even") ?? ""),
    Date.parse(el.getAttribute("data-resume-p50") ?? ""),
  ]);
  expect(waitResumeP50).toBeLessThanOrEqual(waitBreakEven ?? Number.NEGATIVE_INFINITY);
  await captureTop(page, `timeline-${waitExpectation.after}`);

  await stepUntil(page, switchExpectation.after);
  await expect(conclusion).toHaveAttribute("data-action", "switch");
  await expect(timeline).toHaveAttribute("data-relation", "after");
  // 図の値は判断の分岐点と一致し、帯の始まりは分岐点より後にある
  // 切り替えでは閉じたシートに分岐点の時刻を出さないので、開いたシートの説明の時刻と比べる
  const breakEvenTime = await page
    .getByTestId(testIds.judgment.breakEvenSentence)
    .locator("time")
    .first()
    .evaluate((el) => el.getAttribute("datetime"));
  await expect(timeline).toHaveAttribute("data-break-even", breakEvenTime ?? "");
  const [breakEven, resumeP50] = await timeline.evaluate((el) => [
    Date.parse(el.getAttribute("data-break-even") ?? ""),
    Date.parse(el.getAttribute("data-resume-p50") ?? ""),
  ]);
  expect(resumeP50).toBeGreaterThan(breakEven ?? Number.POSITIVE_INFINITY);
  await captureTop(page, `timeline-${switchExpectation.after}`);
});

test("知見の閲覧画面は無く、メニューと説明の頁にも入口が無い", async ({ page }) => {
  const response = await page.goto("/knowledge");
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId(testIds.status.screen)).toBeVisible({ timeout: 30_000 });

  await page.goto("/");
  await page.getByTestId(testIds.app.menuButton).click();
  const menu = page.getByTestId(testIds.app.menu);
  await expect(menu).toBeVisible();
  await expect(menu.locator("a[href='/about']")).toHaveCount(1);
  await expect(menu.locator("a[href^='/knowledge']")).toHaveCount(0);

  await page.goto("/about");
  await expect(page.getByTestId(testIds.about.screen)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("a[href^='/knowledge']")).toHaveCount(0);
});

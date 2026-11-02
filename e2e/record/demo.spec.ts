/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { expect, type Page, test } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { loadReplayScenarios, waitForJudged } from "../support/replay.ts";

// デモ動画の台本（docs/demo-script.md）の 0:25〜1:50 をリプレイで自動操作して録画する
//   0:25〜0:45 最初の掲示 → 推論の過程が順に現れる → 結論と分岐点
//   0:45〜1:30 発表が更新されるたびに、いまここ・分岐点・地図が変わる。分岐点を越えて切り替えへ
//   1:30〜1:50 地図: 止まっている区間、徒歩の到達範囲、動いている別路線、推奨経路
// シナリオは RECORD_SCENARIO で指定する。無ければ、期待値に「切り替える」を含む最初のシナリオ

const playbackSpeed = Number(process.env.RECORD_SPEED ?? 2);

function selectDemoScenario() {
  const scenarios = loadReplayScenarios();
  const requested = process.env.RECORD_SCENARIO;
  const found = requested
    ? scenarios.find((s) => s.id === requested)
    : (scenarios.find((s) => s.expectations.some((e) => e.action === "switch")) ?? scenarios[0]);
  if (!found) throw new Error(`録画するシナリオがありません: ${requested ?? "(未指定)"}`);
  return found;
}

// 再生バーの下に要素が来るよう、なめらかにスクロールする
async function scrollToTestId(page: Page, testId: string, holdMs: number): Promise<void> {
  await page.evaluate((id) => {
    const target = document.querySelector(`[data-testid='${id}']`);
    const bar = document.querySelector("[data-testid='replay-bar']");
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY;
    const offset = (bar?.getBoundingClientRect().height ?? 0) + 12;
    window.scrollTo({ top: top - offset, behavior: "smooth" });
  }, testId);
  await page.waitForTimeout(holdMs);
}

async function scrollToTop(page: Page, holdMs: number): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await page.waitForTimeout(holdMs);
}

test("デモ: リプレイで判断と地図が変わる様子を録画する", async ({ page }) => {
  const scenario = selectDemoScenario();
  const switchAfter = scenario.expectations.find((e) => e.action === "switch")?.after ?? null;
  const [first] = scenario.timeline;
  if (!first) throw new Error("timeline が空です");

  // 一覧からシナリオを選ぶ
  await page.goto("/replay");
  await expect(page.getByTestId(testIds.replay.scenario(scenario.id))).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);
  await page.getByTestId(testIds.replay.scenario(scenario.id)).click();
  await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "idle");
  await page.waitForTimeout(2000);

  // 0:25〜0:45 最初の掲示を 1x で読み、推論の過程と結論を見せる
  await page.getByTestId(testIds.replay.playButton).click();
  await waitForJudged(page, first.id);
  await page.getByTestId(testIds.replay.playButton).click();
  await page.waitForTimeout(3000);
  await scrollToTestId(page, testIds.judgment.breakEven, 3500);
  await scrollToTop(page, 1000);

  // 0:45〜1:30 速度を上げて再生し、判断の更新を見せる
  await page.getByTestId(testIds.replay.speed(playbackSpeed)).click();
  await page.getByTestId(testIds.replay.playButton).click();
  if (switchAfter) {
    await waitForJudged(page, switchAfter, 5 * 60_000);
    await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
      "data-action",
      "switch",
    );
    // 切り替えに変わった瞬間は一時停止して、結論と分岐点を見せる
    await page.getByTestId(testIds.replay.playButton).click();
    await page.waitForTimeout(3500);
    await scrollToTestId(page, testIds.judgment.breakEven, 3000);
    await scrollToTestId(page, testIds.replay.phaseStrip, 3000);
    await scrollToTop(page, 800);
    await page.getByTestId(testIds.replay.playButton).click();
  }
  await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "ended", {
    timeout: 5 * 60_000,
  });
  await page.waitForTimeout(2500);

  // 1:30〜1:50 地図を大きく見せ、選択肢へ流す
  const map = page.getByTestId(testIds.judgment.map);
  await scrollToTestId(page, testIds.judgment.map, 1200);
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await page.waitForTimeout(12_000);
  await scrollToTestId(page, testIds.judgment.options, 5000);
  await scrollToTop(page, 2000);
});

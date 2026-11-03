/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { expect, type Page, test } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import type { Scenario } from "../../packages/schema/src/scenario.ts";
import {
  loadReplayScenarios,
  openSheet,
  type SheetSnap,
  waitForJudged,
} from "../support/replay.ts";

// デモ動画の台本（docs/demo-script.md）の 0:25〜1:50 をリプレイで自動操作して録画する
//   0:25〜0:45 最初の掲示 → 推論の過程が順に現れる → 結論と分岐点
//   0:45〜1:30 発表が更新されるたびに、いまここ・分岐点・地図が変わる。結論が変わるたびに止めて見せる
//   1:30〜1:50 地図: 止まっている区間、徒歩の到達範囲、推奨経路と代替経路
// 続けて、同じ「止まった」でも慌てず待てる事象を流し、行動が逆になる対比を見せる
// 主役は RECORD_SCENARIO、対比は RECORD_CONTRAST で指定する
// 無ければ、主役は期待値に「切り替える」を含む最初のシナリオ、対比は期待値がすべて「待つ」の最初のシナリオ

const playbackSpeed = Number(process.env.RECORD_SPEED ?? 2);

function findScenario(scenarios: Scenario[], id: string): Scenario {
  const found = scenarios.find((s) => s.id === id);
  if (!found) throw new Error(`録画するシナリオがありません: ${id}`);
  return found;
}

function selectDemoScenario(scenarios: Scenario[]): Scenario {
  const requested = process.env.RECORD_SCENARIO;
  if (requested) return findScenario(scenarios, requested);
  const found =
    scenarios.find((s) => s.expectations.some((e) => e.action === "switch")) ?? scenarios[0];
  if (!found) throw new Error("録画するシナリオがありません");
  return found;
}

function selectContrastScenario(scenarios: Scenario[], main: Scenario): Scenario | null {
  const requested = process.env.RECORD_CONTRAST;
  if (requested) return findScenario(scenarios, requested);
  return (
    scenarios.find((s) => {
      const actions = s.expectations.flatMap((e) => (e.action ? [e.action] : []));
      return s.id !== main.id && actions.length > 0 && actions.every((a) => a === "wait");
    }) ?? null
  );
}

// 期待値の結論が変わる観測。最初の観測は別に見せるので除く
function listActionChanges(scenario: Scenario): { after: string; action: string }[] {
  const changes: { after: string; action: string }[] = [];
  let previous: string | null = null;
  for (const e of scenario.expectations) {
    if (!e.action) continue;
    if (previous !== null && e.action !== previous)
      changes.push({ after: e.after, action: e.action });
    previous = e.action;
  }
  return changes;
}

// 地図の上のシートを指定の段まで開き、しばらく見せる
async function showSheet(page: Page, snap: SheetSnap, holdMs: number): Promise<void> {
  await openSheet(page, snap);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(holdMs);
}

// 一覧からシナリオを選び、再生の前の画面で止める
async function pickScenario(page: Page, scenario: Scenario): Promise<void> {
  await page.goto("/replay");
  await expect(page.getByTestId(testIds.replay.scenario(scenario.id))).toBeVisible({
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);
  await page.getByTestId(testIds.replay.scenario(scenario.id)).click();
  await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "idle");
  await page.waitForTimeout(2000);
}

// 最初の掲示を 1x で読み、推論の過程と結論を見せる
async function showFirstJudgment(page: Page, scenario: Scenario): Promise<void> {
  const [first] = scenario.timeline;
  if (!first) throw new Error("timeline が空です");
  await page.getByTestId(testIds.replay.playButton).click();
  await waitForJudged(page, first.id);
  await page.getByTestId(testIds.replay.playButton).click();
  await page.waitForTimeout(3000);
  await showSheet(page, "half", 3500);
  await showSheet(page, "collapsed", 1000);
}

test("デモ: リプレイで判断と地図が変わる様子を録画する", async ({ page }) => {
  const scenarios = loadReplayScenarios();
  const scenario = selectDemoScenario(scenarios);
  const contrast = selectContrastScenario(scenarios, scenario);

  await pickScenario(page, scenario);
  await showFirstJudgment(page, scenario);

  // 速度を上げて再生し、結論が変わるたびに一時停止して、結論とシートの上部を見せる
  await page.getByTestId(testIds.replay.speed(playbackSpeed)).click();
  await page.getByTestId(testIds.replay.playButton).click();
  for (const change of listActionChanges(scenario)) {
    await waitForJudged(page, change.after, 5 * 60_000);
    await page.getByTestId(testIds.replay.playButton).click();
    await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
      "data-action",
      change.action,
    );
    await page.waitForTimeout(3500);
    await showSheet(page, "half", 3000);
    await showSheet(page, "collapsed", 800);
    await page.getByTestId(testIds.replay.playButton).click();
  }
  await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "ended", {
    timeout: 5 * 60_000,
  });
  await page.waitForTimeout(2500);

  // シートを閉じて地図を大きく見せ、結末と選択肢へ戻る
  const map = page.getByTestId(testIds.judgment.map);
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await showSheet(page, "collapsed", 12_000);
  await showSheet(page, "half", 5000);
  await showSheet(page, "full", 2000);

  // 対比: 同じ「止まった」でも、慌てず待てば数分で動く事象。最初から待つと言い切る
  if (!contrast) return;
  await pickScenario(page, contrast);
  await showFirstJudgment(page, contrast);
  await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
    "data-action",
    "wait",
  );
  await page.getByTestId(testIds.replay.playButton).click();
  await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "ended", {
    timeout: 5 * 60_000,
  });
  await page.waitForTimeout(2500);
  await showSheet(page, "half", 5000);
});

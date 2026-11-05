/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { expect, type Page, test } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import type { Scenario } from "../../packages/schema/src/scenario.ts";
import { webUrl } from "../servers.ts";
import {
  createRecordingMarks,
  markFirstScreen,
  markScene,
  type RecordingMarks,
  saveRecordingMarks,
} from "../support/recording-marks.ts";
import {
  loadReplayScenarios,
  openSheet,
  type SheetSnap,
  waitForFiniteAnimations,
  waitForJudged,
} from "../support/replay.ts";

// デモ動画の台本の冒頭の導入からリプレイまでを自動操作して録画する
//   0:25〜0:45 最初の掲示 → 推論の過程が順に現れる → 結論と分岐点
//   0:45〜1:30 発表が更新されるたびに、いまここ・分岐点・地図が変わる。結論が変わるたびに止めて見せる
//   1:30〜1:50 最後に結論が変わった時点の地図: 止まっている区間、徒歩の到達範囲、推奨経路と代替経路
//   残りの観測は次へで送り、結末のカードで締める
// 続けて、同じ「止まった」でも慌てず待てる事象を流し、行動が逆になる対比を見せる
// 主役は RECORD_SCENARIO、対比は RECORD_CONTRAST で指定する
// 無ければ、主役は期待値に「切り替える」を含む最初のシナリオ、対比は期待値がすべて「待つ」の最初のシナリオ

const introHoldMs = 25_000;
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
// 録画はシートの取っ手をキーで動かす。指で動かしたときには出ない、取っ手のフォーカスの枠を消す
async function hideHandleFocusRing(page: Page): Promise<void> {
  const css = `[data-testid="${testIds.judgment.sheetHandle}"]:focus-visible { outline: none; }`;
  await page.addInitScript((rule) => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = rule;
      document.head.append(style);
    });
  }, css);
}

async function showSheet(page: Page, snap: SheetSnap, holdMs: number): Promise<void> {
  await openSheet(page, snap);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(holdMs);
}

// 一覧からシナリオを選び、再生の前の画面で止める
// 一覧の背景の地図と札が描き終わるまで待つ
async function pickScenario(page: Page, scenario: Scenario): Promise<void> {
  await page.goto("/replay");
  await expect(page.getByTestId(testIds.replay.scenario(scenario.id))).toBeVisible({
    timeout: 60_000,
  });
  // 録画の設定の色で描かれていること
  const scheme = test.info().project.use.colorScheme;
  if (scheme === "dark" || scheme === "light") {
    await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${scheme}\\b`));
  }
  await expect(page.getByTestId(testIds.app.backdropMap)).toHaveAttribute("data-state", "ready", {
    timeout: 60_000,
  });
  await waitForFiniteAnimations(page);
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

// 録画の前に、リプレイの画面のコンパイルと本物のフォントの取得を済ませる
// 動画に写らないよう、ページではなく HTTP の要求で温める
test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: webUrl });
  const response = await request.get("/replay", { timeout: 5 * 60_000 });
  expect(response.ok(), "リプレイの画面を温める").toBe(true);
  await request.dispose();
});

// 一時停止したまま、残りの観測を次へで 1 件ずつ入れて最後まで流す
async function finishReplay(page: Page, scenario: Scenario): Promise<void> {
  const screen = page.getByTestId(testIds.replay.screen);
  const judgment = page.getByTestId(testIds.replay.judgment);
  if ((await screen.getAttribute("data-state")) === "playing") {
    await page.getByTestId(testIds.replay.playButton).click();
  }
  const current = await judgment.getAttribute("data-observation-id");
  const start = scenario.timeline.findIndex((e) => e.id === current) + 1;
  for (const entry of scenario.timeline.slice(start)) {
    await page.getByTestId(testIds.replay.nextButton).click();
    await waitForJudged(page, entry.id, 60_000);
  }
  await expect(screen).toHaveAttribute("data-state", "ended");
  await expect(page.getByTestId(testIds.replay.outcome)).toBeVisible();
}

// 結末のカードが落ち着いた時点を静止画の目印にする
async function markOutcome(page: Page, marks: RecordingMarks, name: string): Promise<void> {
  await expect(page.getByTestId(testIds.replay.outcome)).toBeVisible();
  await waitForFiniteAnimations(page);
  markScene(marks, name);
}

test("デモ: リプレイで判断と地図が変わる様子を録画する", async ({ page }) => {
  // 録画の時刻の目印。頁は作られた直後で、録画の最初のフレームと同じころ
  // 終わったら動画と同じ場所に書き、trim-recording.ts が読む
  const marks = createRecordingMarks();
  const scenarios = loadReplayScenarios();
  const scenario = selectDemoScenario(scenarios);
  const contrast = selectContrastScenario(scenarios, scenario);

  await hideHandleFocusRing(page);
  await page.goto("/");
  await expect(page.getByTestId("start-intro")).toBeVisible();
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 60_000,
  });
  await expect(page.getByTestId(testIds.start.originSearch)).toBeInViewport({ ratio: 1 });
  await waitForFiniteAnimations(page);
  markFirstScreen(marks);
  await page.waitForTimeout(introHoldMs);
  await pickScenario(page, scenario);
  await showFirstJudgment(page, scenario);

  // 速度を上げて再生し、結論が変わるたびに一時停止して、結論とシートの上部を見せる
  await page.getByTestId(testIds.replay.speed(playbackSpeed)).click();
  await page.getByTestId(testIds.replay.playButton).click();
  const changes = listActionChanges(scenario);
  for (const [index, change] of changes.entries()) {
    await waitForJudged(page, change.after, 5 * 60_000);
    await page.getByTestId(testIds.replay.playButton).click();
    await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
      "data-action",
      change.action,
    );
    await page.waitForTimeout(3500);
    await showSheet(page, "half", 3000);
    await showSheet(page, "collapsed", 800);
    // 最後の変化では止めたまま、下の地図と結末へ進む
    if (index < changes.length - 1) await page.getByTestId(testIds.replay.playButton).click();
  }

  // 最後に結論が変わった時点で地図を大きく見せる。推奨経路と止まっている区間が主役
  const map = page.getByTestId(testIds.judgment.map);
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await showSheet(page, "collapsed", 9000);

  // 残りの観測は次へで送り、結末のカードへつなぐ。終わるとシートは半分まで開く
  await finishReplay(page, scenario);
  await page.waitForTimeout(1500);
  await markOutcome(page, marks, "outcome-main");
  await page.waitForTimeout(5500);

  // 対比: 同じ「止まった」でも、慌てず待てば数分で動く事象。最初から待つと言い切る
  if (contrast) {
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
    await showSheet(page, "half", 1500);
    await markOutcome(page, marks, "outcome-contrast");
    await page.waitForTimeout(3500);
  }

  await saveRecordingMarks(test.info().outputDir, marks);
});

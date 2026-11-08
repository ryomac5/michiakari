/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { expect, type Page, test } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import type { Scenario } from "../../packages/schema/src/scenario.ts";
import { webUrl } from "../servers.ts";
import { finishEntry } from "../support/add-info.ts";
import { findDemoScene, sceneMarkName, scenesEndMark } from "../support/demo-scenes.ts";
import { chooseBetweenStations } from "../support/entry.ts";
import { findCanvasPointNear, panTo } from "../support/map-view.ts";
import {
  createRecordingMarks,
  markFirstScreen,
  markScene,
  type RecordingMarks,
  saveRecordingMarks,
} from "../support/recording-marks.ts";
import {
  loadReplayScenarios,
  openReplay,
  openSheet,
  type SheetSnap,
  waitForFiniteAnimations,
  waitForJudged,
} from "../support/replay.ts";

// デモ動画の台本（docs/demo-script.md）の場面 1〜10 を順に自動操作して録画する
//   1 開始画面 → 2 入口: 現在地、地図で駅と路線、駅と駅の間 → 3 起きていることの 10 の選択肢
//   4 リプレイの最初の判断 → 5 速度を上げて判断が変わる → 6 地図とバスの欄 → 7 駅と駅の間の車内の判断
//   8 結末のカード → 9 対比のシナリオ → 10 対比の結末のカード
// 各場面の始まりに目印を付け、台本の秒数まで画面を止めて待つ。収まらない場面はそのまま延びる
// 主役は RECORD_SCENARIO、対比は RECORD_CONTRAST で指定する
// 無ければ、主役は期待値に「切り替える」を含む最初のシナリオ、対比は期待値がすべて「待つ」の最初のシナリオ

// 場面 5 の速度。台本の 25 秒に近づけるため、速度のボタンの最大の 8 倍で流す
const playbackSpeed = Number(process.env.RECORD_SPEED ?? 8);
// 場面 8 と 9 は台本の秒数に収めるため、推論の過程を間を空けずに出す速度で流す。5 以上で間が空かない
const fastSpeed = 8;
// 駅と駅の間の丸を押す前に寄せる倍率。引いた地図では丸が駅の印に重なり、押すと駅を選んでしまう
// 描いた環状線の上で、大阪と天満の間にあり、ほかの路線の線から約220m 離れた点。lines.geojson から求めた
const betweenOsakaTemma: [number, number] = [135.508338, 34.706538];
// JR神戸線の塚本と尼崎の中間。現在地から読み取ると、その駅の間を候補に出す
const betweenTsukamotoAmagasaki = { latitude: 34.72229, longitude: 135.450335, accuracy: 20 };
const loopLine = "大阪|jr-west.大阪環状線|JR環状線";

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

function selectContrastScenario(scenarios: Scenario[], main: Scenario): Scenario {
  const requested = process.env.RECORD_CONTRAST;
  if (requested) return findScenario(scenarios, requested);
  const found = scenarios.find((s) => {
    const actions = s.expectations.flatMap((e) => (e.action ? [e.action] : []));
    return s.id !== main.id && actions.length > 0 && actions.every((a) => a === "wait");
  });
  if (!found) throw new Error("対比のシナリオがありません");
  return found;
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

// 場面の始まりに目印を付けて操作し、台本の秒数に足りなければ画面を止めて待つ
async function playScene(
  page: Page,
  marks: RecordingMarks,
  scene: number,
  body: () => Promise<void>,
): Promise<void> {
  const { start, end } = findDemoScene(scene);
  const begin = Date.now();
  markScene(marks, sceneMarkName(scene));
  await body();
  const rest = (end - start) * 1000 - (Date.now() - begin);
  if (rest > 0) await page.waitForTimeout(rest);
}

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

// 地図の上のシートを指定の段まで開き、しばらく見せる
async function showSheet(page: Page, snap: SheetSnap, holdMs: number): Promise<void> {
  await openSheet(page, snap);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(holdMs);
}

function expectStage(page: Page, stage: string) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

// 入口の地図が止まるまで待つ。寄せの途中で押すと、札が動いて別の物を押してしまう
async function waitForEntryMapStill(page: Page): Promise<void> {
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-moving", "false", {
    timeout: 15_000,
  });
  await waitForFiniteAnimations(page);
}

async function openEntry(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 60_000,
  });
  await expectStage(page, "position");
}

// 要素の中心を押す。地図の印は小さいので、Playwright の押せる判定より確かに当てる
async function tapCenter(page: Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} が見えません`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// 入口の戻るで最初の段まで引く
async function backToPosition(page: Page): Promise<void> {
  const screen = page.getByTestId(testIds.start.screen);
  for (let i = 0; i < 6 && (await screen.getAttribute("data-stage")) !== "position"; i++) {
    await page.getByTestId(testIds.start.back).click();
    await page.waitForTimeout(250);
  }
  await expectStage(page, "position");
  await waitForEntryMapStill(page);
}

// 判断の画面の結論と地図が出るまで待つ
async function waitForLiveJudgment(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await waitForFiniteAnimations(page);
}

// 場面 2: 現在地から読み取る、地図でエリア・駅・路線・行き先を押す、駅と駅の間の線を押す
async function showEntryChoices(page: Page): Promise<void> {
  // 現在地から読み取ると、駅と駅の間を候補に出す。はいで確定する
  await page.getByTestId(testIds.start.gpsLocate).click();
  await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveText(
    "JR神戸線の塚本〜尼崎の間ですか",
  );
  await page.waitForTimeout(1800);
  await page.getByTestId(testIds.start.gpsConfirm).click();
  await expectStage(page, "destination");
  await page.waitForTimeout(600);
  await backToPosition(page);

  // 地図でエリア、駅、路線を押す。両方向の駅が出たら行き先の駅を押す
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await expectStage(page, "area");
  await waitForEntryMapStill(page);
  await page.waitForTimeout(300);
  await page.getByTestId(testIds.start.place("osaka")).click();
  await expectStage(page, "destination");
  await waitForEntryMapStill(page);
  await page.waitForTimeout(500);
  await page.getByTestId(testIds.start.mapStop(`line-${loopLine}`)).click();
  await expectStage(page, "direction");
  await waitForEntryMapStill(page);
  await expect(page.getByTestId(testIds.start.mapStop("pick-天満"))).toBeAttached();
  await page.waitForTimeout(1000);
  await tapCenter(page, testIds.start.mapStop("pick-天満"));
  await expectStage(page, "cause");
  await page.waitForTimeout(600);
  await backToPosition(page);

  // 駅と駅の間で止まっていると答え、地図の大阪と天満の間の環状線を押して確かめる
  await page.getByTestId(testIds.start.positionTrain).click();
  await expectStage(page, "between");
  await waitForEntryMapStill(page);
  await page.waitForTimeout(500);
  await page.locator(".maplibregl-canvas").focus();
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const point = await panTo(page, betweenOsakaTemma, {
    x: viewport.width / 2,
    y: viewport.height * 0.25,
  });
  const open = await findCanvasPointNear(page, point);
  await page.mouse.click(open.x, open.y);
  await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveText(
    "JR環状線の大阪〜天満の間ですか",
  );
  await page.waitForTimeout(1000);
  await tapCenter(page, testIds.start.gpsConfirm);
  await expectStage(page, "destination");
}

// 場面 3: 行き先を決め、起きていることの 10 の選択肢を見せて 1 つを選ぶ
async function showCauseChoices(page: Page): Promise<void> {
  await page.getByTestId(testIds.start.destinationSearch).fill("天王寺");
  await page.getByTestId(testIds.start.destinationOption("天王寺")).click();
  // 天王寺は環状線のどちら回りでも行けるので、天満へ向かう回り方を答える
  await expectStage(page, "direction");
  await page
    .locator("[data-testid^='start-direction-']")
    .filter({ hasText: "京橋・鶴橋方面" })
    .click();
  await expectStage(page, "cause");
  const cards = page.locator(
    "[data-testid^='start-cause-']:not([data-testid^='start-cause-kind-'])",
  );
  await expect(cards).toHaveCount(10);
  await waitForFiniteAnimations(page);
  // 10 の選択肢をナレーションの間見せ、終わりぎわに車内の急病人を選ぶ
  await page.waitForTimeout(4500);
  await page.getByTestId(testIds.start.cause("unknown")).scrollIntoViewIfNeeded();
  await page.waitForTimeout(3500);
  await page.getByTestId(testIds.start.cause("inCar")).scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  await page.getByTestId(testIds.start.cause("inCar")).click();
  // 車内の人には「信号を受信したため緊急停止」の放送の問いが出る。見せてから答える
  await expectStage(page, "protection");
  await waitForFiniteAnimations(page);
  await page.waitForTimeout(2500);
  await page.getByTestId("start-protection-notHeard").click();
  await expectStage(page, "elapsed");
}

// 一覧からシナリオを選び、再生の前の画面で止める。一覧の背景の地図と札が描き終わるまで待つ
async function pickScenario(
  page: Page,
  scenario: Scenario,
  holdMs: number,
  speed?: number,
): Promise<void> {
  await page.goto(speed === undefined ? "/replay" : `/replay?speed=${speed}`);
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
  await page.waitForTimeout(holdMs);
  await page.getByTestId(testIds.replay.scenario(scenario.id)).click();
  await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "idle");
}

// 速度は 1 つのボタンで順に切り替わる。指定の速度になるまで押す
async function setReplaySpeed(page: Page, speed: number): Promise<void> {
  const speedToggle = page.getByTestId(testIds.replay.speedToggle);
  for (let i = 0; i < 5; i++) {
    if ((await speedToggle.getAttribute("data-speed")) === String(speed)) break;
    await speedToggle.click();
  }
  await expect(speedToggle).toHaveAttribute("data-speed", String(speed));
}

// 最初の掲示を読み、結論とシートの上部を見せる
async function showFirstJudgment(
  page: Page,
  scenario: Scenario,
  holds: { headline: number; half: number; collapsed: number },
): Promise<void> {
  const [first] = scenario.timeline;
  if (!first) throw new Error("timeline が空です");
  await page.getByTestId(testIds.replay.playButton).click();
  await waitForJudged(page, first.id);
  await page.getByTestId(testIds.replay.playButton).click();
  await page.waitForTimeout(holds.headline);
  await showSheet(page, "half", holds.half);
  if (holds.collapsed > 0) await showSheet(page, "collapsed", holds.collapsed);
}

// 場面 5: 速度を上げて再生し、結論が変わるたびに一時停止して、結論とシートの上部を見せる
// 最後の変化では止めたまま、場面 6 の地図へ進む
async function showActionChanges(page: Page, scenario: Scenario): Promise<void> {
  await setReplaySpeed(page, playbackSpeed);
  await page.getByTestId(testIds.replay.playButton).click();
  const changes = listActionChanges(scenario);
  for (const [index, change] of changes.entries()) {
    await waitForJudged(page, change.after, 5 * 60_000);
    await page.getByTestId(testIds.replay.playButton).click();
    // 結論の値は Claude の結果で揺れるので、一致は確かめず、画面に出ていることだけを待つ
    await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible();
    await page.waitForTimeout(2500);
    await showSheet(page, "half", 2500);
    await showSheet(page, "collapsed", 500);
    if (index < changes.length - 1) await page.getByTestId(testIds.replay.playButton).click();
  }
}

// 場面 6 の後半: リプレイの判断のシートを開き、バスを確かめる欄まで見せる
// 判断にバス停の確認候補が載らないシナリオでは、大阪駅で止まった人の判断を入口から出して見せる
async function showReplayBusChecks(page: Page): Promise<void> {
  const section = page.getByTestId(testIds.judgment.busChecks);
  if ((await section.count()) === 0) {
    await showBusChecks(page);
    return;
  }
  await openSheet(page, "full");
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
  await waitForFiniteAnimations(page);
}

// 大阪駅で止まった人の判断画面を開き、バスを確かめる欄まで見せる
async function showBusChecks(page: Page): Promise<void> {
  await openEntry(page);
  await page.getByTestId(testIds.start.originSearch).fill("大阪");
  await page.getByTestId(testIds.start.originOption("大阪")).click();
  await expectStage(page, "destination");
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await page.getByTestId(testIds.start.cause("unknown")).click();
  await page.getByTestId(testIds.start.elapsed("m10")).click();
  await page.getByTestId(testIds.start.ticket("unknown")).click();
  await page.getByTestId(testIds.start.resume("stated")).click();
  await page.locator("[data-testid^='start-resume-time-']").last().click();
  await waitForLiveJudgment(page);
  await openSheet(page, "full");
  const section = page.getByTestId(testIds.judgment.busChecks);
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
  await waitForFiniteAnimations(page);
}

// 場面 7: 環状線の大阪と天満の間で、車内の急病人で止まった人の判断。車内で待つと停車中を見せる
async function showInCarJudgment(page: Page): Promise<void> {
  await openEntry(page);
  await chooseBetweenStations(page, "JR環状線", "大阪", "天満");
  await page.getByTestId(testIds.start.destinationSearch).fill("天王寺");
  await page.getByTestId(testIds.start.destinationOption("天王寺")).click();
  // 天王寺は環状線のどちら回りでも行けるので、天満へ向かう回り方を答える
  await expectStage(page, "direction");
  await page
    .locator("[data-testid^='start-direction-']")
    .filter({ hasText: "京橋・鶴橋方面" })
    .click();
  await finishEntry(page, {
    cause: "inCar",
    elapsed: "now",
    protection: "notHeard",
    resume: "unknown",
  });
  await waitForLiveJudgment(page);
  await expect(page.getByTestId(testIds.judgment.statusChip)).toBeVisible();
}

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

// 録画の前に、画面のコンパイルと本物のフォントの取得を済ませる
// 動画に写らないよう、ページではなく HTTP の要求で温める
test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext({ baseURL: webUrl });
  for (const path of ["/", "/replay", "/judgment"]) {
    const response = await request.get(path, { timeout: 5 * 60_000 });
    expect(response.ok(), `${path} を温める`).toBe(true);
  }
  await request.dispose();
});

test("デモ: 台本の場面の順に入口からリプレイまでを録画する", async ({ context, page }) => {
  // 録画の時刻の目印。頁は作られた直後で、録画の最初のフレームと同じころ
  // 終わったら動画と同じ場所に書き、trim-recording.ts が読む
  const marks = createRecordingMarks();
  const scenarios = loadReplayScenarios();
  const scenario = selectDemoScenario(scenarios);
  const contrast = selectContrastScenario(scenarios, scenario);

  await context.setGeolocation(betweenTsukamotoAmagasaki);
  await context.grantPermissions(["geolocation"]);
  await hideHandleFocusRing(page);
  await openEntry(page);
  await expect(page.getByTestId(testIds.start.intro)).toBeVisible();
  await expect(page.getByTestId(testIds.start.originSearch)).toBeInViewport({ ratio: 1 });
  await waitForFiniteAnimations(page);
  markFirstScreen(marks);

  // 1. 開始画面。3 行と淡い地図と駅の入力欄をそのまま見せる
  await playScene(page, marks, 1, async () => {});

  // 2. 入口
  await playScene(page, marks, 2, () => showEntryChoices(page));

  // 3. 起きていることの選択
  await playScene(page, marks, 3, () => showCauseChoices(page));

  // 4. リプレイの最初の判断
  await playScene(page, marks, 4, async () => {
    await pickScenario(page, scenario, 1500);
    await page.waitForTimeout(1500);
    await showFirstJudgment(page, scenario, { headline: 3000, half: 3500, collapsed: 1000 });
  });

  // 5. 判断が変わった瞬間
  await playScene(page, marks, 5, () => showActionChanges(page, scenario));

  // 6. 最後に判断が変わった時点の地図を見せ、続けてバスを確かめる欄を見せる
  await playScene(page, marks, 6, async () => {
    const map = page.getByTestId(testIds.judgment.map);
    await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await showSheet(page, "collapsed", 9000);
    await showReplayBusChecks(page);
  });

  // 7. 駅と駅の間の車内の判断
  await playScene(page, marks, 7, () => showInCarJudgment(page));

  // 8. 主役のシナリオを開き直し、残りの観測を次へで送って結末のカードまで進める
  await playScene(page, marks, 8, async () => {
    await openReplay(page, scenario.id, fastSpeed);
    await finishReplay(page, scenario);
    await page.waitForTimeout(1500);
    await markOutcome(page, marks, "outcome-main");
    await page.waitForTimeout(4000);
  });

  // 9. 対比: 同じ「止まった」でも、慌てず待てば数分で動く事象。最初から待つと言い切る
  await playScene(page, marks, 9, async () => {
    await pickScenario(page, contrast, 500, fastSpeed);
    await showFirstJudgment(page, contrast, { headline: 2000, half: 1500, collapsed: 0 });
    await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible();
    await page.getByTestId(testIds.replay.playButton).click();
    await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "ended", {
      timeout: 5 * 60_000,
    });
    await showSheet(page, "half", 0);
  });

  // 10. 対比の結末のカード。開発の様子は編集で重ねる
  await playScene(page, marks, 10, () => markOutcome(page, marks, "outcome-contrast"));
  markScene(marks, scenesEndMark);

  await saveRecordingMarks(test.info().outputDir, marks);
});

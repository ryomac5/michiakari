/// <reference lib="dom" />
// page 内で動かす関数（addInitScript・evaluate）のために DOM の型を読む
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { openSheet } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

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
  // 入口の地図は、駅データを読み終えると data-ready が true になる
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });

  // 駅は国土数値情報の実データからサーバーで探す。選ぶと地図がその駅に寄り、シートに路線が並ぶ
  await page.getByTestId(testIds.start.originSearch).fill("大阪");
  await page.getByTestId(testIds.start.originOption("大阪")).click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "station");
  const kobeLine = "大阪|jr-west.東海道線|JR神戸線";
  await page.getByTestId(testIds.start.line(kobeLine)).click();
  // 路線を選ぶと方面を聞く。行き先は方面の外の駅も検索で選べる
  await page.getByTestId(testIds.start.direction(`${kobeLine}>jr-west.東海道線.神戸`)).click();
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await page.getByTestId(testIds.start.positionStation).click();
  await expect(page.getByTestId(testIds.start.trip)).toContainText("三ノ宮");

  // 状況の入力は別の画面に飛ばず、同じ地図の上のシートで続ける
  await page.getByTestId(testIds.start.method("paste")).click();
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
  // 残り時間は時刻と紛れない「あと N 分」で出し、時刻は文の中に置く
  await expect(page.getByTestId(testIds.judgment.breakEvenCountdown)).toHaveText(/^あと \d+ 分$/);
  await expect(page.getByTestId(testIds.judgment.breakEvenSentence)).toContainText(
    /\d{2}:\d{2}\s?までに再開すれば/,
  );

  const disclaimer = page.getByTestId(testIds.judgment.disclaimer);
  await expect(disclaimer).toBeVisible();
  await expect(disclaimer).toContainText("推定であり、公式発表を優先してください");

  // 地図は描画が終わると data-state="ready" になり、シートの中に地図の見方、地図の隅に出典が出る
  const map = page.getByTestId(testIds.judgment.map);
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(map).toHaveAttribute("data-blocked", "true");
  // 大阪には Valhalla の到達範囲があるので、円ではなく多角形で描く
  await expect(map).toHaveAttribute("data-reach-source", "valhalla");
  await expect(map).toHaveAttribute("data-recommended-option", "wait_resume");
  await expect(page.getByTestId(mapTestIds.legend)).toBeVisible();
  await expect(page.getByTestId(mapTestIds.attribution)).toContainText("国土地理院");
  await expect(page.getByTestId(testIds.judgment.option("transfer_hankyu"))).toBeVisible();
  await expect(page.getByTestId(testIds.judgment.option("transfer_hankyu"))).toContainText("—");

  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}judgment-390x844.png` });
  await openSheet(page, "half");
  await page.screenshot({ path: `${screenshotDir}judgment-390x844-half.png` });
  await openSheet(page, "collapsed");
  await captureMap(page, "judgment-map-390x844.png");
});

// 地図を撮る。タイルの読み込みを待つため ready を確かめてから撮る
async function captureMap(page: Page, fileName: string): Promise<void> {
  const map = page.getByTestId(testIds.judgment.map);
  await expect(map).toHaveAttribute("data-state", "ready");
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}${fileName}` });
}

test("情報を追加すると判断が更新され、根拠に段階と兆候が出る", async ({ page }) => {
  await startWithPastedText(page);
  await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
    "data-action",
    "wait",
    { timeout: 15_000 },
  );

  // 根拠は既定で閉じていて、シートを開いてから根拠を開くと段階の「いまここ」と兆候が見える
  await expect(page.getByTestId(testIds.judgment.phaseTimeline)).toBeHidden();
  await openSheet(page, "full");
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

  // 送ると閉じたシートに戻り、推論の過程が出る
  await expect(page.getByTestId(testIds.judgment.reasoning)).toBeVisible();
  await expect(page.getByTestId(testIds.judgment.sheet)).toHaveAttribute("data-snap", "collapsed");
  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toHaveAttribute("data-action", "switch", { timeout: 15_000 });
  await expect(page.getByTestId(testIds.judgment.breakEven)).toHaveAttribute(
    "data-state",
    "passed",
  );
  // 切り替えでは、閉じたシートに残り時間を出さず、切り替え先の行動を出す
  await expect(page.getByTestId(testIds.judgment.breakEvenCountdown)).toHaveCount(0);
  for (const id of [testIds.judgment.conclusion, testIds.judgment.breakEven]) {
    await expect(page.getByTestId(id)).not.toContainText(/あと \d+ (分|時間)/);
  }
  const step = page.getByTestId(testIds.judgment.switchStep);
  await expect(step).toHaveAttribute("data-option-id", "transfer_hankyu");
  await expect(step).toContainText("阪急神戸線");
  await expect(step).toContainText(/大阪梅田まで徒歩 \d+ 分/);
  await expect(step).toContainText(/\d{2}:\d{2} 着/);
  // 分岐点そのものは、全部開いたシートの説明に残す
  await openSheet(page, "full");
  await expect(page.getByTestId(testIds.judgment.breakEvenSentence)).toContainText(/\d{2}:\d{2}/);
  await openSheet(page, "collapsed");
  await expect(page.getByTestId(testIds.judgment.option("transfer_hankyu"))).toHaveAttribute(
    "data-recommended",
    "true",
  );

  // 判断が変わると地図の推奨経路も追従する
  const map = page.getByTestId(testIds.judgment.map);
  await expect(map).toHaveAttribute("data-recommended-option", "transfer_hankyu");
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await captureMap(page, "judgment-map-switch-390x844.png");
});

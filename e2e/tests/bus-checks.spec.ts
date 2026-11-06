import { fileURLToPath } from "node:url";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  loadReplayScenarios,
  openReplay,
  openSheet,
  waitForFiniteAnimations,
  waitForJudged,
} from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 判断画面の開いて読む段に、近くのバス停を確かめる欄が出る
// 停留所の名前、事業者、徒歩の目安と公式の案内だけを出し、時刻は出さない
// 決定論モードの agent とダミーの内容で確かめる

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(120_000);

test("大阪で止まったとき、判断画面にバスも確かめる欄が出る", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.originSearch).fill("大阪");
  await page.getByTestId(testIds.start.originOption("大阪")).click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "destination");
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await page.getByTestId(testIds.start.cause("unknown")).click();
  await page.getByTestId(testIds.start.elapsed("m10")).click();
  await page.getByTestId(testIds.start.resume("stated")).click();
  await page.locator("[data-testid^='start-resume-time-']").last().click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });

  await openSheet(page, "full");
  const section = page.getByTestId(testIds.judgment.busChecks);
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
  await expect(section).toContainText("バスも確かめる");
  await expect(section).toContainText("鉄道が止まるとバスは混み、遅れやすくなります。");
  await expect(section).toContainText("2022年の情報");

  const items = section.locator("[data-testid^='judgment-bus-check-']");
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(3);
  await expect(items.first()).toContainText(/徒歩約\d+分/);
  // 高速バスの停留所は出さず、同じ名前の停留所は 1 行にまとめる
  await expect(section).not.toContainText("高速バス");
  const names = await items.locator("span.font-semibold").allTextContents();
  expect(new Set(names).size).toBe(names.length);
  // 欄の全体が画面の高さの 3 分の 1 程度に収まる
  const box = await section.boundingBox();
  expect(box?.height ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(844 / 3);
  // 時刻は出さない
  await expect(section).not.toContainText(/\d{1,2}:\d{2}|\d{1,2}時\d{2}分/);
  // 公式の案内は事業者のトップへのリンク。新しいタブで開く
  const link = section.getByRole("link").first();
  await expect(link).toHaveAttribute("href", /^https:\/\/[^/]+\/(?:[a-z]+\/)?$/);
  await expect(link).toHaveAttribute("target", "_blank");

  // 推定である旨と公式発表を優先する旨は消さない
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toHaveCount(1);
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toContainText("公式");

  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}bus-checks-390x844.png` });
});

test("リプレイの判断画面にも、判断の画面と同じバスも確かめる欄が出る", async ({ page }) => {
  // 大阪で止まった架空のシナリオ。最初の発表の判断にバス停の確認候補が載る
  const scenario = loadReplayScenarios().find((s) => s.user.current_station === "大阪");
  if (!scenario) throw new Error("大阪で止まるシナリオがありません");
  const [first] = scenario.timeline;
  if (!first) throw new Error("timeline が空です");
  await openReplay(page, scenario.id);
  await page.getByTestId(testIds.replay.nextButton).click();
  await waitForJudged(page, first.id);

  await openSheet(page, "full");
  const section = page.getByTestId(testIds.judgment.busChecks);
  await section.scrollIntoViewIfNeeded();
  await expect(section).toBeVisible();
  await expect(section).toContainText("バスも確かめる");
  await expect(section).toContainText("2022年の情報");
  const items = section.locator("[data-testid^='judgment-bus-check-']");
  expect(await items.count()).toBeGreaterThan(0);
  // 時刻は出さない
  await expect(section).not.toContainText(/\d{1,2}:\d{2}|\d{1,2}時\d{2}分/);
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toHaveCount(1);

  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}replay-bus-checks-390x844.png` });
});

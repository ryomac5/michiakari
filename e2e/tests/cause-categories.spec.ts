import { fileURLToPath } from "node:url";
import type { Page, Request } from "@playwright/test";
import { findFlowWording } from "../../apps/agent/src/domain/flow-wording.ts";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { openSheet } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 入口の原因は、人身事故と車内の急病人を分けた選択肢と分からないで聞く。知見のある大分類はその事象で判断する
// 知見の無い大分類は、集めた事例の統計値から再開の見込みを出す。分からないは見込みを持たず境目の時刻を目安にする
// 決定論モードの agent とダミーの知見で確かめる

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(90_000);

const categories = [
  "person",
  "inCar",
  "vehicle",
  "signaling",
  "power",
  "obstruction",
  "infrastructure",
  "weather",
  "major_accident",
  "unknown",
];

// 大阪から三ノ宮へ向かう人として、原因の問いまで進む
async function openCauseStage(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await page.getByTestId(testIds.start.place("osaka")).click();
  await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "cause");
}

function expectStage(page: Page, stage: string) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

async function expectDepth(page: Page, depth: number) {
  await expect.poll(() => page.evaluate(() => window.history.state?.entryDepth)).toBe(depth);
}

// 大分類を選び、いま止まった・見込みは言っていないで判断を始める。agent に送った要求を返す
// 種類を聞く大分類では、続けて種類を選ぶ
async function judgeWithCategory(page: Page, category: string, kind?: string): Promise<Request> {
  await page.getByTestId(testIds.start.cause(category)).click();
  if (kind) {
    await expectStage(page, "causeKind");
    await page.getByTestId(testIds.start.causeKind(kind)).click();
  }
  await page.getByTestId(testIds.start.elapsed("now")).click();
  const request = page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/judge",
  );
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
  return request;
}

test("原因の問いは人身事故を先頭に、車内の急病人をその次に置いた 10 の選択肢を出す", async ({
  page,
}) => {
  await openCauseStage(page);
  const cards = page.locator("[data-testid^='start-cause-']");
  await expect(cards).toHaveCount(categories.length);
  for (const id of categories) {
    await expect(page.getByTestId(testIds.start.cause(id))).toBeVisible();
  }
  await expect(cards.nth(0)).toHaveAttribute("data-testid", "start-cause-person");
  await expect(cards.nth(1)).toHaveAttribute("data-testid", "start-cause-inCar");
  await expect(page.getByTestId(testIds.start.cause("person"))).toHaveText("人身事故");
  await expect(page.getByTestId(testIds.start.cause("inCar"))).toHaveText(
    "車内の急病人・非常ボタン",
  );
  await expect(page.getByTestId(testIds.start.cause("signaling"))).toHaveText("信号・ポイント");
});

test("人身事故を選ぶと、続けての問いなしに人身事故の事象で判断する", async ({ page }) => {
  await openCauseStage(page);
  await page.getByTestId(testIds.start.cause("person")).click();
  await expectStage(page, "elapsed");
  await expectDepth(page, 5);
  await page.getByTestId(testIds.start.back).click();
  await expectStage(page, "cause");
  await expectDepth(page, 4);

  const request = await judgeWithCategory(page, "person");
  expect((await request).postDataJSON().newInput).toEqual({
    type: "selection",
    eventType: "person_accident",
    signalIds: [],
  });
  await openSheet(page, "full");
  await expect(page.getByTestId(testIds.judgment.premise)).toContainText(
    "原因は放送で聞いた人身事故と仮定しています。",
  );
});

test("車内の急病人を選ぶと、続けての問いなしに車内対応の事象で判断する", async ({ page }) => {
  await openCauseStage(page);
  const request = await judgeWithCategory(page, "inCar");
  expect((await request).postDataJSON().newInput).toEqual({
    type: "selection",
    eventType: "in_car_response",
    signalIds: [],
  });
  await openSheet(page, "full");
  await expect(page.getByTestId(testIds.judgment.premise)).toContainText(
    "原因は放送で聞いた車内の急病人・非常ボタンと仮定しています。",
  );
});

test("知見のある車両の大分類を選ぶと、車両故障の事象で判断し、前提に呼び名を出す", async ({
  page,
}) => {
  await openCauseStage(page);
  const request = await judgeWithCategory(page, "vehicle");
  expect((await request).postDataJSON().newInput).toEqual({
    type: "selection",
    eventType: "vehicle_failure",
    signalIds: [],
  });
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toBeVisible();

  await openSheet(page, "full");
  const premise = page.getByTestId(testIds.judgment.premise);
  await expect(premise).toContainText("原因は放送で聞いた車両の故障・点検と仮定しています。");
  await expect(premise).not.toContainText("境目の時刻を動く目安");
});

test("知見の無い電力の大分類を選ぶと、統計値から見込みの図を出し、前提に呼び名だけを出す", async ({
  page,
}) => {
  await openCauseStage(page);
  const request = await judgeWithCategory(page, "power");
  const body = (await request).postDataJSON();
  expect(body.newInput).toBeNull();
  expect(body.cause).toEqual({ group: "power", type: null });
  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  // 事象は決め打ちしない。統計値は長引いた事例に偏るので、見込みの確かさは低いまま
  await expect(conclusion).toHaveAttribute("data-action", /^(hold|switch)$/);
  await expect(page.getByTestId(testIds.judgment.confidence)).toHaveAttribute("data-level", "low");
  await expect(page.getByTestId(testIds.judgment.resumeChance)).toBeVisible();
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toContainText(
    "推定であり、公式発表を優先してください",
  );

  await openSheet(page, "full");
  const premise = page.getByTestId(testIds.judgment.premise);
  await expect(premise).toContainText("原因は放送で聞いた停電と仮定する");
  await expect(premise).not.toContainText("境目の時刻を動く目安");
  await expect(premise).not.toContainText("原因は未確認");
  // 見込みの出どころの説明は出さない
  await expect(page.getByTestId(testIds.judgment.sheet)).not.toContainText(/統計|事例/);
});

test("知見の無い信号・ポイントを選ぶと、判断まで進んで見込みの図を出し、再開までの時間を文で言い切らない", async ({
  page,
}) => {
  await openCauseStage(page);
  const request = await judgeWithCategory(page, "signaling");
  const body = (await request).postDataJSON();
  expect(body.newInput).toBeNull();
  expect(body.cause).toEqual({ group: "signaling", type: null });
  await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
    "data-action",
    /^(hold|switch)$/,
  );
  await expect(page.getByTestId(testIds.judgment.resumeChance)).toBeVisible();
  const ticks = page.locator("[data-testid^='judgment-resume-chance-tick-']");
  await expect.poll(() => ticks.count()).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toContainText(
    "推定であり、公式発表を優先してください",
  );
  await page.screenshot({ path: `${screenshotDir}cause-signaling-statistics-390x844.png` });

  await openSheet(page, "full");
  const premise = page.getByTestId(testIds.judgment.premise);
  await expect(premise).toContainText("原因は放送で聞いた信号・ポイントと仮定する");
  await expect(premise).not.toContainText("境目の時刻を動く目安");
  // 結論の見出しと理由に、再開までの時間を言い切る文が無い
  const conclusionText = [
    await page.getByTestId(testIds.judgment.conclusionHeadline).textContent(),
    (await page.getByTestId(testIds.judgment.conclusionReason).count()) > 0
      ? await page.getByTestId(testIds.judgment.conclusionReason).textContent()
      : "",
  ].join("\n");
  expect(findFlowWording(conclusionText, "ja")).toBeNull();
  await expect(page.getByTestId(testIds.judgment.sheet)).not.toContainText(/統計|事例/);
});

test("分からないを選ぶと、原因を送らず、見込みの図を出さずに境目の時刻を目安にする", async ({
  page,
}) => {
  await openCauseStage(page);
  const request = await judgeWithCategory(page, "unknown");
  const body = (await request).postDataJSON();
  expect(body.newInput).toBeNull();
  expect(body.cause).toBeUndefined();
  await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
    "data-action",
    "hold",
  );
  await expect(page.getByTestId(testIds.judgment.resumeChance)).toHaveCount(0);
  await openSheet(page, "full");
  const premise = page.getByTestId(testIds.judgment.premise);
  await expect(premise).toContainText("原因は未確認");
  await expect(premise).toContainText("境目の時刻を動く目安");
  await expect(page.getByTestId(testIds.judgment.nextCheck)).toContainText("原因");
});

test("雨・風・雪・地震から雨を選ぶと、大雨の事象で判断し、戻るで種類の問いへ 1 段ずつ引く", async ({
  page,
}) => {
  await openCauseStage(page);
  await page.getByTestId(testIds.start.cause("weather")).click();
  await expectStage(page, "causeKind");
  await expectDepth(page, 5);
  const kinds = page.locator("[data-testid^='start-cause-kind-']");
  await expect(kinds).toHaveCount(6);
  await expect(page.getByTestId(testIds.start.causeKind("rain"))).toHaveText("雨");
  await expect(page.getByTestId(testIds.start.causeKind("snow"))).toHaveText("雪・凍結");
  await page.getByTestId(testIds.start.back).click();
  await expectStage(page, "cause");

  const request = await judgeWithCategory(page, "weather", "rain");
  expect((await request).postDataJSON().newInput).toEqual({
    type: "selection",
    eventType: "heavy_rain",
    signalIds: [],
  });
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toBeVisible();
  await openSheet(page, "full");
  await expect(page.getByTestId(testIds.judgment.premise)).toContainText(
    "原因は放送で聞いた雨・風・雪・地震と仮定しています。",
  );

  await page.goBack();
  await expectStage(page, "resume");
  await expectDepth(page, 7);
  await expect(page.getByTestId(testIds.start.answer("cause"))).toContainText("雨");
  await page.goBack();
  await expectStage(page, "elapsed");
  await expectDepth(page, 6);
  await page.goBack();
  await expectStage(page, "causeKind");
  await expectDepth(page, 5);
  await page.goBack();
  await expectStage(page, "cause");
  await expectDepth(page, 4);
});

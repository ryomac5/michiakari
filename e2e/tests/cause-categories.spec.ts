import { fileURLToPath } from "node:url";
import type { Page, Request } from "@playwright/test";
import { findFlowWording } from "../../apps/agent/src/domain/flow-wording.ts";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { finishEntry, openAddInfo, waitForJudgmentReady } from "../support/add-info.ts";
import { openSheet } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 原因は判断の画面の情報を追加するで、人身事故と車内の急病人を分けた選択肢から選ぶ。種類の決まる大分類はその事象で判断する
// 種類の決まらない大分類は、集めた事例の統計値から再開の見込みを出す。答えないうちは見込みを持たず境目の時刻を目安にする
// 決定論モードの agent とダミーの内容で確かめる

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
];

function waitForJudgeRequest(page: Page): Promise<Request> {
  return page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/judge",
  );
}

// 大阪から三ノ宮へ向かう人として、いる所と行き先だけを答えて判断を出す。最初の要求を返す
async function openJudgment(page: Page): Promise<Request> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await page.getByTestId(testIds.start.place("osaka")).click();
  const request = waitForJudgeRequest(page);
  await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
  await finishEntry(page);
  return request;
}

// 情報を追加するで大分類を選び、判断を出し直す。agent に送った要求を返す
// 種類を聞く大分類では、続けて種類を選ぶ
async function judgeWithCategory(page: Page, category: string, kind?: string): Promise<Request> {
  const addInfo = await openAddInfo(page);
  const request = waitForJudgeRequest(page);
  await addInfo.getByTestId(testIds.situation.causeOption(category)).click();
  if (kind) await addInfo.getByTestId(testIds.situation.causeKindOption(kind)).click();
  await waitForJudgmentReady(page);
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
  return request;
}

test("原因の選択肢は人身事故を先頭に、車内の急病人をその次に置いた 9 の大分類を出す", async ({
  page,
}) => {
  await openJudgment(page);
  const addInfo = await openAddInfo(page);
  const cards = addInfo.locator("[data-testid^='situation-cause-']");
  await expect(cards).toHaveCount(categories.length);
  for (const id of categories) {
    await expect(addInfo.getByTestId(testIds.situation.causeOption(id))).toBeVisible();
  }
  await expect(cards.nth(0)).toHaveAttribute("data-testid", "situation-cause-person");
  await expect(cards.nth(1)).toHaveAttribute("data-testid", "situation-cause-inCar");
  await expect(addInfo.getByTestId(testIds.situation.causeOption("person"))).toHaveText("人身事故");
  await expect(addInfo.getByTestId(testIds.situation.causeOption("inCar"))).toHaveText(
    "車内の急病人・非常ボタン",
  );
  await expect(addInfo.getByTestId(testIds.situation.causeOption("signaling"))).toHaveText(
    "信号・ポイント",
  );
});

test("人身事故を選ぶと、続けての問いなしに人身事故の事象で判断する", async ({ page }) => {
  await openJudgment(page);
  const request = await judgeWithCategory(page, "person");
  expect((await request).postDataJSON().newInput).toEqual({
    type: "selection",
    eventType: "person_collision",
    signalIds: [],
  });
  await openSheet(page, "full");
  await expect(page.getByTestId(testIds.judgment.premise)).toContainText(
    "原因は放送で聞いた人身事故と仮定しています。",
  );
});

test("車内の急病人を選ぶと、続けての問いなしに車内対応の事象で判断する", async ({ page }) => {
  await openJudgment(page);
  const request = await judgeWithCategory(page, "inCar");
  expect((await request).postDataJSON().newInput).toEqual({
    type: "selection",
    eventType: "medical_response",
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
  await openJudgment(page);
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
  await openJudgment(page);
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
  await expect(premise).toContainText("原因は放送で聞いた停電と仮定しています");
  await expect(premise).not.toContainText("境目の時刻を動く目安");
  await expect(premise).not.toContainText("原因は未確認");
  // 見込みの出どころの説明は出さない
  await expect(page.getByTestId(testIds.judgment.sheet)).not.toContainText(/統計|事例/);
});

test("知見の無い信号・ポイントを選ぶと、判断まで進んで見込みの図を出し、再開までの時間を文で言い切らない", async ({
  page,
}) => {
  await openJudgment(page);
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
  await expect(premise).toContainText("原因は放送で聞いた信号・ポイントと仮定しています");
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

test("原因を答えないうちは、原因を送らず、見込みの図を出さずに境目の時刻を目安にする", async ({
  page,
}) => {
  const request = await openJudgment(page);
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

test("雨・風・雪・地震から雨を選ぶと大雨の事象で判断し、原因の札から種類を選び直せる", async ({
  page,
}) => {
  await openJudgment(page);
  let addInfo = await openAddInfo(page);
  await addInfo.getByTestId(testIds.situation.causeOption("weather")).click();
  const kinds = addInfo.locator("[data-testid^='situation-cause-kind-']");
  await expect(kinds).toHaveCount(6);
  await expect(addInfo.getByTestId(testIds.situation.causeKindOption("rain"))).toHaveText("雨");
  await expect(addInfo.getByTestId(testIds.situation.causeKindOption("snow"))).toHaveText(
    "雪・凍結",
  );
  // 種類の問いから大分類の問いへ戻れる
  await addInfo.getByRole("button", { name: "原因を選び直す" }).click();
  await expect(addInfo.getByTestId(testIds.situation.causeOption("weather"))).toBeVisible();

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

  // 決まった原因は札に残り、押すと種類まで選び直せる
  addInfo = await openAddInfo(page);
  const chip = addInfo.getByTestId(testIds.situation.answer("cause"));
  await expect(chip).toHaveText("雨");
  await chip.click();
  await addInfo.getByTestId(testIds.situation.causeOption("weather")).click();
  const again = waitForJudgeRequest(page);
  await addInfo.getByTestId(testIds.situation.causeKindOption("wind")).click();
  await waitForJudgmentReady(page);
  expect((await again).postDataJSON().newInput).toEqual({
    type: "selection",
    eventType: "strong_wind",
    signalIds: [],
  });
  addInfo = await openAddInfo(page);
  await expect(addInfo.getByTestId(testIds.situation.answer("cause"))).toHaveText("風");
});

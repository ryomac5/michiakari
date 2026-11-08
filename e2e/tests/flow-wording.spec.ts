import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { addAnswers, finishEntry, openAddInfo } from "../support/add-info.ts";
import { openReplay, openSheet, waitForJudged } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 短く終わる事象で慌てず待つと伝える結論と、段階の名前を出さない根拠の欄
// 事象の決まった流れや再開までの時間を言い切る文は、どこにも出さない
// 決定論モードの agent とダミーのシナリオで確かめる

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(120_000);

const reassuring = "このまま待つ";
const nonDecisive =
  /まだ判断できません|判断できません|分かりません|わかりません|情報が足りません|材料が不足|見込みが立ちません/;

const flowWording = /よくある流れ|ふつう|[0-9０-９]+(時間|分)ほどで(再開|終わ)/;
const stageWording = /の段階|段階です/;

// 根拠の欄を開き、聞いた言葉が出て、事象の段階の名前が出ないことを確かめる
async function expectNoStageReading(page: Page, heard: string | RegExp): Promise<void> {
  const toggle = page.getByTestId(testIds.judgment.evidenceToggle);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const evidence = page.getByTestId(testIds.judgment.evidence);
  const first = evidence.locator("li").first();
  await expect(first.getByTestId(testIds.judgment.evidenceHeard)).toHaveText(heard);
  await expect(evidence.locator("[data-phase-id]")).toHaveCount(0);
  await expect(evidence).not.toContainText(stageWording);
}

// シートのどこにも、事象の決まった流れや再開までの時間を言い切る文が無い
async function expectNoFlowWording(page: Page): Promise<void> {
  await expect(page.getByTestId(testIds.judgment.sheet)).not.toContainText(flowWording);
}

test("車内対応のリプレイでは、止まった直後でも待つになり、根拠に段階の名前は出ない", async ({
  page,
}) => {
  await openReplay(page, "in_car_response_loop", 60);
  await page.getByTestId(testIds.replay.nextButton).click();
  await waitForJudged(page, "obs_1");

  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toHaveAttribute("data-action", "wait");
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toHaveText(reassuring);
  // 流れが読める事象なので、見込みの確かさは低にならない
  await expect(page.getByTestId(testIds.judgment.confidence)).not.toHaveAttribute(
    "data-level",
    "low",
  );
  await expectBlockedTagClearOfToggle(page);

  // 理由は待つ場合との比較で書き、再開までの時間を事象の流れとして言い切らない
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).toHaveText(
    /^待つほうが早く着きます。$/,
  );
  await openSheet(page, "full");
  await expectNoStageReading(page, /^「.+急病のお客様.+」$/);
  await expectNoFlowWording(page);
});

// 「見合わせ」の札が出るなら、「全体を見る」のボタンに重ならない
async function expectBlockedTagClearOfToggle(page: Page): Promise<void> {
  const map = page.getByTestId(testIds.judgment.map);
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  const toggle = page.getByTestId(mapTestIds.viewToggle);
  const tag = page.getByTestId(mapTestIds.blockedTag);
  await expect(toggle).toBeVisible();
  if ((await tag.count()) === 0) return;
  const [a, b] = [await tag.boundingBox(), await toggle.boundingBox()];
  if (!a || !b) return;
  const overlaps =
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(
    overlaps,
    `見合わせの札が全体を見るのボタンに重なる 札 ${JSON.stringify(a)} ボタン ${JSON.stringify(b)}`,
  ).toBe(false);
}

test("人身事故のリプレイでは、発生直後から切り替えを言い切り、再開までの時間は文で言い切らない", async ({
  page,
}) => {
  await openReplay(page, "person_accident_last_train", 60);
  await page.getByTestId(testIds.replay.nextButton).click();
  await waitForJudged(page, "obs_1");

  // 発生直後でも、統計値の見込みが分岐点より後なので切り替えを言い切る
  // 見込みの確かさは、再開に近づく手がかりが無い統計値なので低のままでよい
  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toHaveAttribute("data-action", "switch");
  await expect(page.getByTestId(testIds.judgment.confidence)).toHaveAttribute(
    "data-level",
    /^(low|medium|high)$/,
  );
  // 理由の先頭は待つ場合との比較。境目という言葉だけで比べた結果を言わない
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).toHaveText(
    /^待つより.+のほうが早く着きます。$/,
  );
  await expect(page.getByTestId(testIds.judgment.resumeChance)).toBeVisible();
  await openSheet(page, "full");
  await expectNoStageReading(page, /^「.+」$/);
  await expectNoFlowWording(page);
});

test("情報を追加するで「車内の急病人・非常ボタン」を足すと、待つの判断と安心させる文が出る", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.originSearch).fill("京橋");
  await page.getByTestId(testIds.start.originOption("京橋")).click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "destination");
  await page.getByTestId(testIds.start.destinationSearch).fill("天王寺");
  await page.getByTestId(testIds.start.destinationOption("天王寺")).click();
  await finishEntry(page);

  // 原因は情報を追加するで足す。車内の急病人・非常ボタンは人身事故と別の選択肢で、種類の問いは続かない
  const addInfo = await openAddInfo(page);
  await expect(addInfo.getByTestId(testIds.situation.causeOption("inCar"))).toHaveText(
    "車内の急病人・非常ボタン",
  );
  await addAnswers(page, { cause: "inCar", elapsed: "now", resume: "unknown" });
  const added = await openAddInfo(page);
  await expect(added.getByTestId(testIds.situation.answer("cause"))).toContainText(
    "車内の急病人・非常ボタン",
  );
  await expect(added.getByTestId(testIds.situation.answer("elapsed"))).toContainText(
    "いま止まった",
  );
  await openSheet(page, "collapsed");

  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toHaveAttribute("data-action", "wait", { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toHaveText(reassuring);
  await expect(conclusion).not.toContainText(nonDecisive);

  await expect(page.getByTestId(testIds.judgment.conclusionReason)).not.toContainText(flowWording);
  await openSheet(page, "full");
  // 短く終わる事象なので、次に確かめることは再開見込みではなく発車の放送にする
  const nextCheck = page.getByTestId(testIds.judgment.nextCheck);
  await expect(nextCheck).toContainText("まもなく発車");
  await expect(nextCheck).not.toContainText("再開見込み");
  // 根拠を開いても段階の名前は出さない。聞いたことは足した原因の呼び名にする
  await expectNoStageReading(page, "「車内の急病人・非常ボタン」");
  await expect(page.getByTestId(testIds.judgment.evidence)).not.toContainText("車内対応");
  await expectNoFlowWording(page);
});

test("このアプリについての最初に、作った理由が出る", async ({ page }) => {
  await page.goto("/about");
  const why = page.getByTestId(testIds.about.why);
  await expect(why).toBeVisible({ timeout: 30_000 });
  await expect(why).toContainText("作った理由");
  await expect(why).toContainText("鉄道の指令員として働いてきました");
});

import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { loadReplayKnowledge, openReplay, openSheet, waitForJudged } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 短く終わる事象で慌てず待つと伝える結論と、根拠の欄のいまの段階
// 事象の決まった流れや再開までの時間を言い切る文は、どこにも出さない
// 決定論モードの agent とダミーの車内対応で確かめる

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(120_000);

const reassuring = "このまま待つ";
const nonDecisive =
  /まだ判断できません|判断できません|分かりません|わかりません|情報が足りません|材料が不足|見込みが立ちません/;

const flowWording = /よくある流れ|ふつう|[0-9０-９]+(時間|分)ほどで(再開|終わ)/;

// 根拠の欄を開き、先頭の項目がいまの段階を指すことと、その読めることの文を確かめる
async function expectCurrentReading(page: Page, phaseId: string, reading: string): Promise<void> {
  const toggle = page.getByTestId(testIds.judgment.evidenceToggle);
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const current = page.getByTestId(testIds.judgment.evidence).locator("li").first();
  await expect(current).toHaveAttribute("data-phase-id", phaseId);
  await expect(current).toHaveAttribute("data-current", "true");
  await expect(current.getByTestId(testIds.judgment.evidenceReading)).toHaveText(reading);
}

// シートのどこにも、事象の決まった流れや再開までの時間を言い切る文が無い
async function expectNoFlowWording(page: Page): Promise<void> {
  await expect(page.getByTestId(testIds.judgment.sheet)).not.toContainText(flowWording);
}

test("車内対応のリプレイでは、止まった直後でも待つになり、根拠にいまの段階が出る", async ({
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
  await expectCurrentReading(page, "stopped_for_check", "いまは停車して確認の段階です。");
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

  // 発生直後でも、1 時間はかかる見込みが分岐点より後なので切り替えを言い切る
  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toHaveAttribute("data-action", "switch");
  await expect(page.getByTestId(testIds.judgment.confidence)).not.toHaveAttribute(
    "data-level",
    "low",
  );
  // 理由の先頭は待つ場合との比較。境目という言葉だけで比べた結果を言わない
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).toHaveText(
    /^待つより.+のほうが早く着きます。$/,
  );
  await expect(page.getByTestId(testIds.judgment.resumeChance)).toBeVisible();
  await openSheet(page, "full");
  await expectCurrentReading(page, "initial", "いまは発生直後の段階です。");
  await expectNoFlowWording(page);
});

test("入口で「車内の急病人・非常ボタン」を選ぶと、待つの判断と安心させる文が出る", async ({
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

  // 様子の段は方式を選ばせず、すぐに原因を聞く。原因、時間、再開見込みの順に答える
  // 車内の急病人・非常ボタンは人身事故と別の選択肢で、続けての種類の問いなしに経過の問いへ進む
  const inCar = page.getByTestId(testIds.start.cause("inCar"));
  await expect(inCar).toHaveText("車内の急病人・非常ボタン");
  await inCar.click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "elapsed");
  await expect(page.getByTestId(testIds.start.answer("cause"))).toContainText(
    "車内の急病人・非常ボタン",
  );
  await page.getByTestId(testIds.start.elapsed("now")).click();
  await expect(page.getByTestId(testIds.start.answer("elapsed"))).toContainText("いま止まった");
  await page.getByTestId(testIds.start.resume("unknown")).click();

  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
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
  // 根拠を開いても、知見の本文は出さない。聞いたことは入口で選んだ原因の呼び名にする
  await expectCurrentReading(page, "stopped_for_check", "いまは停車して確認の段階です。");
  const knowledge = loadReplayKnowledge().find((k) => k.id === "in_car_response");
  if (!knowledge) throw new Error("車内対応の知見がありません");
  const evidence = page.getByTestId(testIds.judgment.evidence);
  const item = page.getByTestId(testIds.judgment.evidenceItem("in_car_response"));
  await expect(item.getByTestId(testIds.judgment.evidenceHeard)).toHaveText(
    "「車内の急病人・非常ボタン」",
  );
  await expect(evidence).not.toContainText("車内対応");
  await expectNoFlowWording(page);
  const sheet = page.getByTestId(testIds.judgment.sheet);
  const knowledgeTexts = [
    knowledge.summary.ja,
    knowledge.predictability?.basis?.ja,
    ...knowledge.phases.flatMap((phase) => [
      phase.description,
      phase.guidance.ja,
      ...phase.signals.map((signal) => signal.description),
    ]),
  ].filter((text): text is string => typeof text === "string" && text.length > 0);
  for (const text of knowledgeTexts) {
    await expect(evidence).not.toContainText(text);
    await expect(sheet).not.toContainText(text);
  }
});

test("このアプリについての最初に、作った理由が出る", async ({ page }) => {
  await page.goto("/about");
  const why = page.getByTestId(testIds.about.why);
  await expect(why).toBeVisible({ timeout: 30_000 });
  await expect(why).toContainText("作った理由");
  await expect(why).toContainText("過去の事例から見込みを出します");
});

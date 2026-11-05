import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { loadReplayKnowledge, openReplay, openSheet, waitForJudged } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// よくある流れの欄と、短く終わる事象で慌てず待つと伝える結論
// 決定論モードの agent とダミーの車内対応で確かめる

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(120_000);

const reassuring = "このまま待つ";
const nonDecisive =
  /まだ判断できません|判断できません|分かりません|わかりません|情報が足りません|材料が不足|見込みが立ちません/;

async function expectFlow(page: Page, sectionId: string, eventType: string): Promise<void> {
  const flow = page.getByTestId(sectionId);
  await expect(flow).toBeVisible();
  await expect(flow).toHaveAttribute("data-event-type", eventType);
  await expect(flow).toHaveAttribute("data-predictability", "high");
  await expect(flow).toContainText("よくある流れ");
}

test("車内対応のリプレイでは、止まった直後でも待つになり、よくある流れの欄が出る", async ({
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

  // 半分では 1 行の要約だけ、全部開くと帯と見込みの根拠が出る
  await openSheet(page, "half");
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).toContainText(
    "車内対応はふつう5〜10分で終わります",
  );
  await expectFlow(page, testIds.replay.phaseStrip, "in_car_response");
  const current = page.getByTestId(testIds.replay.phase("stopped_for_check"));
  await expect(current).toHaveAttribute("data-position", "current");
  await expect(current).toBeHidden();
  await openSheet(page, "full");
  await expect(current).toBeVisible();
  await expect(current).toContainText("約2分");
  // 知見の根拠の文は出さず、数値から組み立てた要約を添える
  const basis = page.getByTestId(`${testIds.replay.phaseStrip}-basis`);
  await expect(basis).toBeVisible();
  await expect(basis).toHaveText("流れが読みやすいふつう5〜10分で終わる");
  // 帯の各段の目安の合計は、再開までの見込み 5〜10 分の下端にそろう
  const minutes = await page
    .getByTestId(testIds.replay.phaseStrip)
    .locator("li[data-position]")
    .evaluateAll((els) =>
      els.map((el) => Number(/約(\d+)分/.exec(el.textContent ?? "")?.[1] ?? Number.NaN)),
    );
  expect(minutes.reduce((a, b) => a + b, 0)).toBe(5);
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

test("人身事故のリプレイでは、よくある流れで再開まで 1 時間ほどと伝える", async ({ page }) => {
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
  // 理由の先頭は、知見の数値から組み立てたよくある流れの一文
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).toHaveText(
    "人身事故はふつう1時間ほどで再開します。",
  );
  await openSheet(page, "half");
  await expectFlow(page, testIds.replay.phaseStrip, "person_accident");
  await expect(page.getByTestId(testIds.replay.phase("initial"))).toHaveAttribute(
    "data-position",
    "current",
  );
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
  // 大分類の人身事故・お客様対応を選ぶと、続けて種類を 1 問だけ聞く
  const passenger = page.getByTestId(testIds.start.cause("passenger"));
  await expect(passenger).toHaveText("人身事故・お客様対応");
  await passenger.click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "causeKind");
  const inCar = page.getByTestId(testIds.start.causeKind("inCar"));
  await expect(inCar).toHaveText("車内の急病人・非常ボタン");
  await inCar.click();
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

  await openSheet(page, "half");
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).toContainText(
    "車内対応はふつう5〜10分で終わります",
  );
  await expectFlow(page, testIds.judgment.flow, "in_car_response");
  // 段階はよくある流れの欄にまとめ、根拠の中には重ねて出さない
  await openSheet(page, "full");
  // 短く終わる事象なので、次に確かめることは再開見込みではなく発車の放送にする
  const nextCheck = page.getByTestId(testIds.judgment.nextCheck);
  await expect(nextCheck).toContainText("まもなく発車");
  await expect(nextCheck).not.toContainText("再開見込み");
  await page.getByTestId(testIds.judgment.evidenceToggle).click();
  await expect(page.getByTestId(testIds.judgment.phaseTimeline)).toHaveCount(0);
  // 根拠を開いても、知見の本文は出さない。事象の名前と数値から組み立てた要約を出す
  const knowledge = loadReplayKnowledge().find((k) => k.id === "in_car_response");
  if (!knowledge) throw new Error("車内対応の知見がありません");
  const evidence = page.getByTestId(testIds.judgment.evidence);
  await expect(page.getByTestId(testIds.judgment.evidenceItem("in_car_response"))).toContainText(
    "車内対応のよくある流れ · ふつう5〜10分で終わる",
  );
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
  await expect(page.getByTestId(testIds.judgment.flowPhase("stopped_for_check"))).toBeVisible();
});

test("このアプリについての最初に、作った理由が出る", async ({ page }) => {
  await page.goto("/about");
  const why = page.getByTestId(testIds.about.why);
  await expect(why).toBeVisible({ timeout: 30_000 });
  await expect(why).toContainText("作った理由");
  await expect(why).toContainText("この先の流れはある程度読めます");
});

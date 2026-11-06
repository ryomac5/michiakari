import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 入口で原因に「聞き取れなかった」、再開見込みに放送の時刻を選んだときの結論
// 原因が分からなくても、発表の時刻を見込みとして分岐点と比べ、待つか切り替えるかを言い切る
// 決定論モードの agent とダミーの内容で確かめる

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));

// 利用者に「分からない」と返す言い回し。結論と理由には出さない
const nonDecisive =
  /まだ判断できません|判断できません|分かりません|わかりません|情報が足りません|材料が不足|見込みが立ちません/;

// 大阪から JR 神戸線で三ノ宮へ向かう途中で止まった想定。原因は聞き取れず、再開見込みの時刻だけを選ぶ
async function answerWithStatedTime(page: Page, pickTime: "second" | "last"): Promise<string> {
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
  await expect(page.getByTestId(testIds.start.trip)).toContainText("三ノ宮");

  await page.getByTestId(testIds.start.cause("unknown")).click();
  await expect(page.getByTestId(testIds.start.answer("cause"))).toContainText("聞き取れなかった");
  await page.getByTestId(testIds.start.elapsed("m10")).click();
  await page.getByTestId(testIds.start.resume("stated")).click();
  const times = page.locator("[data-testid^='start-resume-time-']");
  await expect(times).toHaveCount(8);
  // 2 つ目は 10〜20 分先で分岐点より十分前、最後は 70〜80 分先で分岐点より十分後になる
  const chosen = pickTime === "second" ? times.nth(1) : times.last();
  const label = (await chosen.textContent()) ?? "";
  await chosen.click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  return label;
}

// 「HH:MM」か「H時MM分」の表示を 0 時からの分にする
function toMinuteOfDay(text: string): number {
  const match = /(\d{1,2})(?::|時)(\d{2})/.exec(text);
  if (!match) throw new Error(`時刻の表示がありません: ${text}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(120_000);

test("原因が聞き取れなくても、放送の再開時刻が分岐点より前なら待つと言い切る", async ({ page }) => {
  const statedLabel = await answerWithStatedTime(page, "second");
  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toHaveAttribute("data-action", "wait", { timeout: 30_000 });
  // 境目の時刻まで待つと言い切り、動かなければ乗る路線を次の手として添える
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toHaveText(
    /^\d{1,2}時\d{2}分まで待つ$/,
  );
  await expect(page.getByTestId(testIds.judgment.conclusionNext)).toContainText(/動かなければ.+へ/);
  await expect(conclusion).not.toContainText(nonDecisive);
  // 発表の時刻を見込みに使うので、見込みの確かさは低にならない
  await expect(page.getByTestId(testIds.judgment.confidence)).not.toHaveAttribute(
    "data-level",
    "low",
  );

  // 選んだ時刻は境目より前にある。見出しの時刻は図の境目の時刻と同じ
  const breakEvenText = await page.getByTestId(testIds.judgment.breakEvenTime).textContent();
  expect(diffMinutes(statedLabel, breakEvenText ?? "")).toBeLessThan(0);
  const headlineText = await page.getByTestId(testIds.judgment.conclusionHeadline).textContent();
  expect(toMinuteOfDay(headlineText ?? "")).toBe(toMinuteOfDay(breakEvenText ?? ""));
  // 右上の数字は境目までの残り時間 1 つだけ
  await expect(page.getByTestId(testIds.judgment.breakEvenCountdown)).toHaveText(/^あと\d+分$/);

  // 理由は、発表の時刻をもとにした推定だと分かる言い方にする
  const summary = page.getByTestId(testIds.judgment.conclusionReason);
  await expect(summary).toContainText(`発表どおり${toJapaneseClock(statedLabel)}に再開すれば`);
  await expect(summary).toContainText("待つほうが早く着きます");
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  // 動かなかったときに乗る駅には、切り替えのおすすめと同じ見た目の吹き出しに「動かなければ」を添える
  const nextText = (await page.getByTestId(testIds.judgment.conclusionNext).textContent()) ?? "";
  const fallbackLine = /動かなければ(.+)へ/.exec(nextText)?.[1] ?? "";
  const fallback = page.locator("[data-testid^='judgment-map-station-'][data-fallback='true']");
  await expect(fallback).toHaveCount(1);
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAttribute("data-variant", "full");
  await expect(fallback.getByTestId(mapTestIds.fallbackTag)).toHaveText("動かなければ");
  await expect(fallback).toContainText(fallbackLine);
  // 待つ判断では、おすすめの星は出さない
  await expect(
    page.locator("[data-testid^='judgment-map-station-'][data-starred='true']"),
  ).toHaveCount(0);
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}stated-resume-wait-390x844.png` });
  await openSheet(page, "half");
  // 理由の残りに、境目の時刻までに動く見込みを添える
  const reason = page.getByTestId(testIds.judgment.conclusionReasonDetail);
  await expect(reason).toContainText(/\d{1,2}時\d{2}分までに動く見込みは/);
  await expect(reason).not.toContainText(nonDecisive);
});

test("原因が聞き取れなくても、放送の再開時刻が分岐点より後なら切り替えると言い切る", async ({
  page,
}) => {
  const statedLabel = await answerWithStatedTime(page, "last");
  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toHaveAttribute("data-action", "switch", { timeout: 30_000 });
  // どの路線に、どこから乗るかを言い切る
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toHaveText(
    /^.+まで歩いて.+へ$|^.+に乗り換える$/,
  );
  await expect(conclusion).not.toContainText(nonDecisive);
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).toContainText(
    `発表どおり${toJapaneseClock(statedLabel)}に再開しても`,
  );
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}stated-resume-switch-390x844.png` });

  // 選んだ時刻は境目より後にある。境目は開いたシートの説明に残る
  await openSheet(page, "full");
  const sentence = await page.getByTestId(testIds.judgment.breakEvenSentence).textContent();
  expect(diffMinutes(statedLabel, sentence ?? "")).toBeGreaterThan(0);
  const reason = page.getByTestId(testIds.judgment.conclusionReasonDetail);
  await expect(reason).toContainText(/\d{1,2}時\d{2}分までに動く見込みは/);
  await expect(reason).not.toContainText(nonDecisive);
});

// 「22:10」を理由の文の書き方「22時10分」にする
function toJapaneseClock(label: string): string {
  const match = /(\d{1,2}):(\d{2})/.exec(label);
  if (!match) throw new Error(`時刻の表示がありません: ${label}`);
  return `${Number(match[1])}時${match[2]}分`;
}

// 2 つの時刻の差（分）。日付をまたぐ時刻も比べられるよう、差を -12 時間〜12 時間に収める
function diffMinutes(a: string, b: string): number {
  const day = 24 * 60;
  const diff = (toMinuteOfDay(a) - toMinuteOfDay(b) + day) % day;
  return diff > day / 2 ? diff - day : diff;
}

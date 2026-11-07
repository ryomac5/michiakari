import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { addAnswers, finishEntry } from "../support/add-info.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 原因を答えず、情報を追加するで再開見込みに放送の時刻を選んだときの結論
// 原因が分からなくても、発表の時刻を見込みとして分岐点と比べ、待つか切り替えるかを言い切る
// 決定論モードの agent とダミーの内容で確かめる

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));

// 利用者に「分からない」と返す言い回し。結論と理由には出さない
const nonDecisive =
  /まだ判断できません|判断できません|分かりません|わかりません|情報が足りません|材料が不足|見込みが立ちません/;

// 大阪から JR 神戸線で三ノ宮へ向かう途中で止まった想定。原因は聞き取れず、再開見込みの時刻だけを足す
async function answerWithStatedTime(
  page: Page,
  pickTime: "first" | "second" | "last",
): Promise<string> {
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
  await finishEntry(page);
  // 原因は答えず、止まってからの時間と放送で聞いた再開見込みの時刻だけを足す
  // 最初は 0〜10 分先で分岐点より前、最後は 70〜80 分先で分岐点より十分後になる
  // 原因が分からないときも初列車待ちを規則表の区間の値で見込むので、2 つ目は分岐点の近くになる
  const label = await addAnswers(page, { elapsed: "m10", resume: { time: pickTime } });
  return label ?? "";
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
  const statedLabel = await answerWithStatedTime(page, "first");
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
  // 見出しの待つ時刻は、発表の時刻より前にならない
  expect(diffMinutes(headlineText ?? "", statedLabel)).toBeGreaterThanOrEqual(0);
  // 右上の数字は境目までの残り時間 1 つだけ
  await expect(page.getByTestId(testIds.judgment.breakEvenCountdown)).toHaveText(/^あと\d+分$/);

  // 理由は、発表の時刻をもとにした推定だと分かる言い方にする
  const summary = page.getByTestId(testIds.judgment.conclusionReason);
  await expect(summary).toContainText(`発表どおり${toJapaneseClock(statedLabel)}に再開すれば`);
  await expect(summary).toContainText("待つほうが早く着きます");
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  // 動かなかったときに乗る駅は地図に出さず、シートの一覧に残す。地図は勧める経路と今いる位置と行き先だけにする
  const nextText = (await page.getByTestId(testIds.judgment.conclusionNext).textContent()) ?? "";
  const fallbackLine = /動かなければ(.+)へ/.exec(nextText)?.[1] ?? "";
  expect(fallbackLine.length).toBeGreaterThan(0);
  const fallback = page.locator("[data-testid^='judgment-map-station-'][data-fallback='true']");
  await expect(fallback).toHaveCount(0);
  await expect(page.getByTestId(mapTestIds.fallbackTag)).toHaveCount(0);
  // 待つ判断では、駅の候補の吹き出しを出さない
  await expect(page.locator("[data-testid^='judgment-map-station-']")).toHaveCount(0);
  await expect(page.getByTestId(testIds.judgment.options)).toContainText(fallbackLine);
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

test("放送の再開時刻が分岐点の近くでも、見出しの時刻は発表の時刻と食い違わない", async ({
  page,
}) => {
  const statedLabel = await answerWithStatedTime(page, "second");
  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toHaveAttribute("data-action", /^(wait|switch)$/, { timeout: 30_000 });
  const headline = page.getByTestId(testIds.judgment.conclusionHeadline);
  await expect(headline).not.toBeEmpty();
  const headlineText = (await headline.textContent()) ?? "";
  if ((await conclusion.getAttribute("data-action")) === "wait") {
    // 待つなら、見出しの待つ時刻は発表の時刻と同じか後
    expect(diffMinutes(headlineText, statedLabel)).toBeGreaterThanOrEqual(0);
  } else {
    // 発表の時刻が分岐点より後なので、待つ時刻を見出しに出さず切り替える
    expect(headlineText).not.toMatch(/まで待つ/);
    await expect(page.getByTestId(testIds.judgment.conclusionReason)).toContainText(
      `発表どおり${toJapaneseClock(statedLabel)}に再開しても`,
    );
    await openSheet(page, "full");
    const sentence = await page.getByTestId(testIds.judgment.breakEvenSentence).textContent();
    expect(diffMinutes(statedLabel, sentence ?? "")).toBeGreaterThan(0);
  }
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

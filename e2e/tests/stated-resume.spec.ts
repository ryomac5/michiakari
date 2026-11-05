import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
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

// 「HH:MM」の表示を 0 時からの分にする
function toMinuteOfDay(text: string): number {
  const match = /(\d{1,2}):(\d{2})/.exec(text);
  if (!match) throw new Error(`時刻の表示がありません: ${text}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(120_000);

test("原因が聞き取れなくても、放送の再開時刻が分岐点より前なら待つと言い切る", async ({ page }) => {
  const statedLabel = await answerWithStatedTime(page, "second");
  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toHaveAttribute("data-action", "wait", { timeout: 30_000 });
  // 発表の時刻を見込みに使うので、確信度は低にならず、保留の形にもならない
  await expect(conclusion).not.toContainText("確信度 低");
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toContainText(
    /あと\d+分は待つ/,
  );
  await expect(conclusion).not.toContainText(nonDecisive);

  // 選んだ時刻は分岐点より前にある
  const breakEvenText = await page.getByTestId(testIds.judgment.breakEvenTime).textContent();
  expect(toMinuteOfDay(statedLabel)).toBeLessThan(toMinuteOfDay(breakEvenText ?? ""));

  // 見出しの「あと23分」と分岐点の行の「あと 23 分」は、同じ基準時刻から数えて同じ数字になる
  const headlineText = await page.getByTestId(testIds.judgment.conclusionHeadline).textContent();
  const headlineMinutes = Number(/あと(\d+)分/.exec(headlineText ?? "")?.[1]);
  await expect(page.getByTestId(testIds.judgment.breakEvenCountdown)).toHaveText(
    new RegExp(`あと\\s*${headlineMinutes}\\s*分`),
  );

  // 理由は、発表の時刻をもとにした推定だと分かる言い方にする
  await openSheet(page, "half");
  const reason = page.getByTestId(testIds.judgment.conclusionReasonDetail);
  await expect(reason).toContainText("発表の再開見込み");
  await expect(reason).toContainText("見込みどおりなら");
  await expect(reason).not.toContainText(nonDecisive);
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}stated-resume-wait-390x844.png` });
});

test("原因が聞き取れなくても、放送の再開時刻が分岐点より後なら切り替えると言い切る", async ({
  page,
}) => {
  const statedLabel = await answerWithStatedTime(page, "last");
  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toHaveAttribute("data-action", "switch", { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toContainText(/に切り替える/);
  await expect(conclusion).not.toContainText(nonDecisive);

  // 選んだ時刻は分岐点より後にある。分岐点は全部開いたシートの説明に残る
  await openSheet(page, "full");
  const sentence = await page.getByTestId(testIds.judgment.breakEvenSentence).textContent();
  expect(toMinuteOfDay(statedLabel)).toBeGreaterThan(toMinuteOfDay(sentence ?? ""));
  const reason = page.getByTestId(testIds.judgment.conclusionReasonDetail);
  await expect(reason).toContainText("発表の再開見込み");
  await expect(reason).toContainText("見込みどおりでも");
  await expect(reason).not.toContainText(nonDecisive);
});

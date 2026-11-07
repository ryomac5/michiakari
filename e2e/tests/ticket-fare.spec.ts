import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { addAnswers, finishEntry, openAddInfo, waitForJudgmentReady } from "../support/add-info.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 乗車券の種類で、乗り換え先の費用の見せ方が変わる。IC カードは振替輸送の対象外で運賃がかかり、定期券は振替の対象
// 決定論モードの agent とダミーの内容で確かめる。塚本の駅から JR 神戸線で三ノ宮へ向かう途中で止まった想定

const screenshotDir = fileURLToPath(new URL("../screenshots/ticket/", import.meta.url));

test.use({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
test.setTimeout(150_000);

// 塚本の駅から三ノ宮への判断を出し、人身事故と止まってからの時間を足す
async function openJudgment(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.originSearch).fill("塚本");
  await page.getByTestId(testIds.start.originOption("塚本")).click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "destination");
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await finishEntry(page, { cause: "person", elapsed: "m10" });
}

async function judgeWithTicket(page: Page, ticket: "ic" | "commuter_pass"): Promise<void> {
  await openJudgment(page);
  await addAnswers(page, { ticket });
  await openSheet(page, "full");
}

test("情報を追加するで乗車券の種類を足せ、答えるまでは札に出さない", async ({ page }) => {
  await openJudgment(page);
  let addInfo = await openAddInfo(page);
  await expect(addInfo.getByTestId(testIds.situation.answer("ticket"))).toHaveCount(0);
  await addInfo.getByTestId(testIds.situation.item("ticket")).click();
  for (const id of ["ic", "commuter_pass", "paper", "unknown"]) {
    await expect(addInfo.getByTestId(testIds.situation.option("ticket", id))).toBeVisible();
  }
  await expect(addInfo.getByTestId(testIds.situation.option("ticket", "ic"))).toHaveText(
    "IC カード",
  );
  await addInfo.getByTestId(testIds.situation.option("ticket", "ic")).scrollIntoViewIfNeeded();
  await waitForFiniteAnimations(page);
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: `${screenshotDir}question.png` });
  await addInfo.getByTestId(testIds.situation.option("ticket", "commuter_pass")).click();
  await waitForJudgmentReady(page);
  addInfo = await openAddInfo(page);
  const chip = addInfo.getByTestId(testIds.situation.answer("ticket"));
  await expect(chip).toContainText("定期券");
  await chip.scrollIntoViewIfNeeded();
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}question-pass.png` });
});

// 判断の画面で発表の文を貼り、判断を出し直す
async function pasteAnnouncement(page: Page, text: string): Promise<void> {
  const addInfo = page.getByTestId(testIds.judgment.addInfo);
  await addInfo.scrollIntoViewIfNeeded();
  // 貼る欄が開いたままなら、そのまま貼る
  const input = addInfo.getByTestId(testIds.situation.pasteInput);
  if (!(await input.isVisible())) await addInfo.getByTestId(testIds.situation.tab("paste")).click();
  await input.fill(text);
  await addInfo.getByTestId(testIds.situation.submit("paste")).click();
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready", {
    timeout: 30_000,
  });
}

async function expectFares(page: Page, fare: string, text: string): Promise<void> {
  const fares = page.getByTestId(testIds.judgment.optionFare);
  await expect(fares.first()).toBeVisible();
  for (const item of await fares.all()) {
    await expect(item).toHaveAttribute("data-fare", fare);
    await expect(item).toHaveText(text);
  }
}

test("IC カードなら乗り換え先に運賃がかかると出し、定期券は振替の発表を見てから振替の対象と出す", async ({
  page,
}) => {
  await judgeWithTicket(page, "ic");
  await expectFares(page, "fare_required", "運賃がかかります");
  // 推定である旨の注意書きは残る
  await expect(page.getByTestId(testIds.judgment.screen)).toContainText("推定");
  await page.getByTestId(testIds.judgment.optionFare).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screenshotDir}judgment-ic.png` });

  // 定期券は、振替輸送の実施が分からないうちは費用を出さない
  await judgeWithTicket(page, "commuter_pass");
  await expect(page.getByTestId(testIds.judgment.option("wait"))).toBeVisible();
  await expect(page.getByTestId(testIds.judgment.optionFare)).toHaveCount(0);

  // 振替先が書かれていない発表なら、振替の対象になりうるにとどめる
  await pasteAnnouncement(page, "振替輸送を行っています。");
  await expectFares(page, "possibly_covered", "振替の対象になりえます");

  // 振替先に阪急と阪神が書かれた発表なら、振替の対象と出す
  await pasteAnnouncement(page, "阪急線、阪神線で振替輸送を行っています。");
  await expectFares(page, "covered", "振替の対象");
  await openSheet(page, "full");
  await page.getByTestId(testIds.judgment.optionFare).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screenshotDir}judgment-pass.png` });

  // 振替輸送を行わないとあれば、定期券でも運賃がかかる
  await pasteAnnouncement(page, "振替輸送は行っておりません。");
  await expectFares(page, "fare_required", "運賃がかかります");
});

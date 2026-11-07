import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 乗車券の種類で、乗り換え先の費用の見せ方が変わる。IC カードは振替輸送の対象外で運賃がかかり、定期券は振替の対象
// 決定論モードの agent とダミーの内容で確かめる。塚本の駅から JR 神戸線で三ノ宮へ向かう途中で止まった想定

const screenshotDir = fileURLToPath(new URL("../screenshots/ticket/", import.meta.url));

test.use({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
test.setTimeout(150_000);

function expectStage(page: Page, stage: string) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

// 再開見込みの問いまで進む。乗車券の問いはこの問いの上にある
async function reachResumeStep(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.originSearch).fill("塚本");
  await page.getByTestId(testIds.start.originOption("塚本")).click();
  await expectStage(page, "destination");
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await expectStage(page, "cause");
  await page.getByTestId(testIds.start.cause("person")).click();
  await expectStage(page, "elapsed");
  await page.getByTestId(testIds.start.elapsed("m10")).click();
  await expectStage(page, "resume");
}

async function judgeWithTicket(page: Page, ticket: "ic" | "commuter_pass"): Promise<void> {
  await reachResumeStep(page);
  await page.getByTestId(testIds.start.ticket(ticket)).click();
  await expect(page.getByTestId(testIds.start.ticket(ticket))).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready", {
    timeout: 30_000,
  });
  await openSheet(page, "full");
}

test("再開見込みの問いの上で乗車券の種類を聞き、既定は分からない", async ({ page }) => {
  await reachResumeStep(page);
  for (const id of ["ic", "commuter_pass", "paper", "unknown"]) {
    await expect(page.getByTestId(testIds.start.ticket(id))).toBeVisible();
  }
  await expect(page.getByTestId(testIds.start.ticket("unknown"))).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId(testIds.start.ticket("ic"))).toHaveText("IC カード");
  await waitForFiniteAnimations(page);
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: `${screenshotDir}question.png` });
  await page.getByTestId(testIds.start.ticket("commuter_pass")).click();
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}question-pass.png` });
});

test("IC カードなら乗り換え先に運賃がかかると出し、定期券なら振替の対象と出す", async ({
  page,
}) => {
  await judgeWithTicket(page, "ic");
  const icFares = page.getByTestId(testIds.judgment.optionFare);
  await expect(icFares.first()).toBeVisible();
  for (const fare of await icFares.all()) {
    await expect(fare).toHaveAttribute("data-fare", "fare_required");
    await expect(fare).toHaveText("運賃がかかります");
  }
  // 推定である旨の注意書きは残る
  await expect(page.getByTestId(testIds.judgment.screen)).toContainText("推定");
  await icFares.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screenshotDir}judgment-ic.png` });

  await judgeWithTicket(page, "commuter_pass");
  const passFares = page.getByTestId(testIds.judgment.optionFare);
  await expect(passFares.first()).toBeVisible();
  for (const fare of await passFares.all()) {
    await expect(fare).toHaveAttribute("data-fare", "covered");
    await expect(fare).toHaveText("振替の対象");
  }
  await passFares.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screenshotDir}judgment-pass.png` });
});

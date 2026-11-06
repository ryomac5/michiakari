import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { chooseTrainDirection } from "../support/entry.ts";
import { expect, test } from "../support/test.ts";

// 止まり方の区別。車内の急病人や非常ボタンはその列車だけが止まり、人身事故は区間を止める
// その列車だけが止まるときは、上部の札・地図・判断の文で「見合わせ」と言わない。決定論モードの agent とダミーの内容で確かめる

test.use({ viewport: { width: 390, height: 844 } });

// 大阪から環状線で京橋・鶴橋方面へ向かう途中、大阪と天満の間で止まった。原因の種類を選んで判断を始める
async function startOnLoopLine(page: Page, kind: "inCar" | "person"): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await chooseTrainDirection(page, "JR環状線", "寺田町");
  await expect(page.getByTestId(testIds.start.trainSegment)).toContainText("大阪 → 天満");
  await page.getByTestId(testIds.start.positionBetween).click();
  await page.getByTestId(testIds.start.destinationSearch).fill("天王寺");
  await page.getByTestId(testIds.start.destinationOption("天王寺")).click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "cause");
  await page.getByTestId(testIds.start.cause(kind)).click();
  await page.getByTestId(testIds.start.elapsed("now")).click();
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready", {
    timeout: 30_000,
  });
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
}

test("車内の急病人・非常ボタンでは、上部の札を停車中にし、地図に止まった区間の線と見合わせの札を出さない", async ({
  page,
}) => {
  await startOnLoopLine(page, "inCar");
  const status = page.getByTestId(testIds.judgment.statusChip);
  await expect(status).toHaveAttribute("data-scope", "train");
  await expect(status).toHaveText("大阪〜天満で停車中");
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-blocked", "false");
  await expect(page.getByTestId(mapTestIds.blockedTag)).toHaveCount(0);
  // 判断の文にも地図の札にも、見合わせは出ない
  await expect(page.getByTestId(testIds.judgment.screen)).not.toContainText("見合わせ");
});

test("人身事故では、上部の札と地図に運転見合わせを出す", async ({ page }) => {
  await startOnLoopLine(page, "person");
  const status = page.getByTestId(testIds.judgment.statusChip);
  await expect(status).toHaveAttribute("data-scope", "section");
  await expect(status).toContainText("見合わせ");
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-blocked", "true");
});

test("駅で待つ人には、車内の急病人・非常ボタンを後続の遅れとして伝え、見合わせと言わない", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.originSearch).fill("京橋");
  await page.getByTestId(testIds.start.originOption("京橋")).click();
  await page.getByTestId(testIds.start.destinationSearch).fill("天王寺");
  await page.getByTestId(testIds.start.destinationOption("天王寺")).click();
  await page.getByTestId(testIds.start.cause("inCar")).click();
  await page.getByTestId(testIds.start.elapsed("now")).click();
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready", {
    timeout: 30_000,
  });
  const status = page.getByTestId(testIds.judgment.statusChip);
  await expect(status).toHaveAttribute("data-scope", "train");
  await expect(status).toContainText("後続に遅れ");
  await expect(page.getByTestId(testIds.judgment.screen)).not.toContainText("見合わせ");
});

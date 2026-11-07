import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { addAnswers, expectJudgmentOpened } from "../support/add-info.ts";
import { chooseBetweenStations } from "../support/entry.ts";
import { expect, test } from "../support/test.ts";

// 止まり方の区別。車内の急病人や非常ボタンはその列車だけが止まり、人身事故は区間を止める
// 車両の故障や信号の不具合はその列車から止まり、発表に区間が出るまでは見合わせと言わない
// その列車だけが止まるときは、上部の札・地図・判断の文で「見合わせ」と言わない。決定論モードの agent とダミーの内容で確かめる

test.use({ viewport: { width: 390, height: 844 } });

// 大阪から環状線で京橋・鶴橋方面へ向かう途中、大阪と天満の間で止まった。判断が出たら原因の種類を足す
async function startOnLoopLine(page: Page, kind: "inCar" | "person" | "vehicle"): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await chooseBetweenStations(page, "JR環状線", "大阪", "天満");
  await page.getByTestId(testIds.start.destinationSearch).fill("天王寺");
  await page.getByTestId(testIds.start.destinationOption("天王寺")).click();
  // 天王寺は環状線のどちら回りでも行けるので、進む向きを聞く。天満へ向かう回り方を答える
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "direction");
  await page
    .locator("[data-testid^='start-direction-']")
    .filter({ hasText: "京橋・鶴橋方面" })
    .click();
  await expectJudgmentOpened(page);
  await addAnswers(page, {
    cause: kind,
    protection: "notHeard",
    elapsed: "now",
    resume: "unknown",
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
  await expect(page.getByTestId(mapTestIds.sectionNote)).toHaveCount(0);
  // 判断の文にも地図の札にも、見合わせは出ない
  await expect(page.getByTestId(testIds.judgment.screen)).not.toContainText("見合わせ");
});

test("車両の故障では、その列車から止まるので、上部の札を停車中にし、見合わせを出さない", async ({
  page,
}) => {
  await startOnLoopLine(page, "vehicle");
  const status = page.getByTestId(testIds.judgment.statusChip);
  await expect(status).toHaveAttribute("data-scope", "train");
  await expect(status).toHaveText("大阪〜天満で停車中");
  await expect(page.getByTestId(mapTestIds.blockedTag)).toHaveCount(0);
  await expect(page.getByTestId(mapTestIds.sectionNote)).toHaveCount(0);
  await expect(page.getByTestId(testIds.judgment.screen)).not.toContainText("見合わせ");
});

test("人身事故では、上部の札に運転見合わせを出し、発表に区間が無ければ区間も札も出さない", async ({
  page,
}) => {
  await startOnLoopLine(page, "person");
  const status = page.getByTestId(testIds.judgment.statusChip);
  await expect(status).toHaveAttribute("data-scope", "section");
  await expect(status).toContainText("見合わせ");
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-blocked", "false");
  await expect(page.getByTestId(mapTestIds.sectionNote)).toHaveCount(0);
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
  await expectJudgmentOpened(page);
  await addAnswers(page, { cause: "inCar", elapsed: "now", resume: "unknown" });
  const status = page.getByTestId(testIds.judgment.statusChip);
  await expect(status).toHaveAttribute("data-scope", "train");
  await expect(status).toContainText("後続に遅れ");
  await expect(page.getByTestId(testIds.judgment.screen)).not.toContainText("見合わせ");
});

test("駅で待つ人には、信号の不具合を後続の遅れとして伝え、見合わせと言わない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.originSearch).fill("京橋");
  await page.getByTestId(testIds.start.originOption("京橋")).click();
  await page.getByTestId(testIds.start.destinationSearch).fill("天王寺");
  await page.getByTestId(testIds.start.destinationOption("天王寺")).click();
  await expectJudgmentOpened(page);
  await addAnswers(page, { cause: "signaling", elapsed: "now", resume: "unknown" });
  const status = page.getByTestId(testIds.judgment.statusChip);
  await expect(status).toHaveAttribute("data-scope", "train");
  await expect(status).toContainText("後続に遅れ");
  await expect(page.getByTestId(testIds.judgment.screen)).not.toContainText("見合わせ");
});

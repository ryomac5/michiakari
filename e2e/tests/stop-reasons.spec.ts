import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { chooseBetweenStations } from "../support/entry.ts";
import { waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 電車の中の判断に、自分の列車が止まった理由のいちばん高い見込みを 1 行出す
// 決定論モードの agent とダミーの内容で確かめる。時間帯で運転間隔が変わっても理由が変わらない場面を選ぶ

const screenshotDir = fileURLToPath(new URL("../screenshots/stop-reasons/", import.meta.url));

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(150_000);

function expectStage(page: Page, stage: string | RegExp) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

type Entry = {
  cause: string;
  causeKind?: string;
  protection: "heard" | "notHeard";
  elapsed: "now" | "m10" | "m30";
};

// 大阪から JR 神戸線で三ノ宮へ向かう途中、大阪と塚本の間で止まった
async function startInCar(page: Page, entry: Entry): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await chooseBetweenStations(page, "JR神戸線", "大阪", "塚本");
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  const screen = page.getByTestId(testIds.start.screen);
  await expectStage(page, /^(cause|direction)$/);
  if ((await screen.getAttribute("data-stage")) === "direction")
    await page.locator("[data-testid^='start-direction-'][data-testid$='.神戸']").click();
  await expectStage(page, "cause");
  await page.getByTestId(testIds.start.cause(entry.cause)).click();
  if (entry.causeKind) {
    await expectStage(page, "causeKind");
    await page.getByTestId(testIds.start.causeKind(entry.causeKind)).click();
  }
  await expectStage(page, /^(protection|elapsed)$/);
  if ((await screen.getAttribute("data-stage")) === "protection")
    await page.getByTestId(`start-protection-${entry.protection}`).click();
  await page.getByTestId(testIds.start.elapsed(entry.elapsed)).click();
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready", {
    timeout: 30_000,
  });
}

async function capture(page: Page, name: string): Promise<void> {
  await waitForFiniteAnimations(page);
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: `${screenshotDir}${name}.png` });
}

test("電車の中の判断に、止まった理由のいちばん高い見込みを 1 行出す", async ({ page }) => {
  // 車内の急病人で 30 分止まっている。後ろに続いた列車が多く、詰まりがいちばん高い
  await startInCar(page, { cause: "inCar", protection: "notHeard", elapsed: "m30" });
  const line = page.getByTestId(testIds.judgment.stopReason);
  await expect(line).toHaveAttribute("data-reason", "queued_behind");
  await expect(line).toHaveText("前の列車がつかえて止まっている可能性が高いです");
  await expect(page.getByTestId(testIds.judgment.conclusion)).toContainText(
    "前の列車がつかえて止まっている可能性が高いです",
  );
  await capture(page, "01-incar-queued");
});

test("人身事故で止まった直後でも、この列車で起きたとは出さず、区間ごと止められている見込みを出す", async ({
  page,
}) => {
  await startInCar(page, { cause: "person", protection: "notHeard", elapsed: "now" });
  const line = page.getByTestId(testIds.judgment.stopReason);
  await expect(line).toHaveAttribute("data-reason", "dispatcher_order");
  await expect(line).toHaveText("区間ごと止められている可能性が高いです");
  await capture(page, "04-person-now");
});

test("大雨では、区間ごと止められている見込みを出す", async ({ page }) => {
  await startInCar(page, {
    cause: "weather",
    causeKind: "rain",
    protection: "notHeard",
    elapsed: "m10",
  });
  const line = page.getByTestId(testIds.judgment.stopReason);
  await expect(line).toHaveAttribute("data-reason", "dispatcher_order");
  await expect(line).toHaveText("区間ごと止められている可能性が高いです");
  await capture(page, "02-rain-dispatcher");
});

test("受信の放送が聞こえたときは、防護無線の読みだけを出し、同じ意味の行を重ねない", async ({
  page,
}) => {
  await startInCar(page, { cause: "unknown", protection: "heard", elapsed: "now" });
  await expect(page.getByTestId(testIds.judgment.protection)).toHaveText(
    "近くで非常停止があったと読めます",
  );
  await expect(page.getByTestId(testIds.judgment.stopReason)).toHaveCount(0);
  await capture(page, "03-protection-heard");
});

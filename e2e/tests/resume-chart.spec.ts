import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  addAnswers,
  type CauseAnswerInput,
  finishEntry,
  openAddInfo,
  waitForJudgmentReady,
} from "../support/add-info.ts";
import { chooseBetweenStations } from "../support/entry.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 判断の画面の再開の見込みの図。見込みの出どころが規則、統計値、発表の時刻、再開のどれでも、
// 半分まで引き上げたシートで図の下端まで見える。降車の案内と駅と駅の間の車内では図を出さない
// 決定論モードの agent とダミーの内容で確かめる

const screenshotDir = fileURLToPath(new URL("../screenshots/resume-chart/", import.meta.url));
const viewport = { width: 390, height: 844 };

test.use({ viewport, deviceScaleFactor: 2 });
test.setTimeout(120_000);

async function openEntry(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
}

// 大阪から三ノ宮へ向かう人として、いる所と行き先を答えて判断を出す
async function openJudgment(page: Page): Promise<void> {
  await openEntry(page);
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.originSearch).fill("大阪");
  await page.getByTestId(testIds.start.originOption("大阪")).click();
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await finishEntry(page);
}

// 判断を出し、原因、10 分くらい前に止まった、見込みは言っていないを足す。原因が null なら答えない
async function judgeWithCause(page: Page, cause: CauseAnswerInput | null): Promise<void> {
  await openJudgment(page);
  await addAnswers(page, {
    ...(cause ? { cause } : {}),
    elapsed: "m10",
    resume: "unknown",
  });
  await openSheet(page, "collapsed");
  await waitForJudgment(page);
}

// 京橋から天王寺へ向かう人として判断を出し、情報を追加するで発表の文を貼り付ける
async function judgeWithPaste(page: Page, pasted: string): Promise<void> {
  await openEntry(page);
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.originSearch).fill("京橋");
  await page.getByTestId(testIds.start.originOption("京橋")).click();
  await page.getByTestId(testIds.start.destinationSearch).fill("天王寺");
  await page.getByTestId(testIds.start.destinationOption("天王寺")).click();
  await finishEntry(page);
  const addInfo = await openAddInfo(page);
  await addInfo.getByTestId(testIds.situation.tab("paste")).click();
  await addInfo.getByTestId(testIds.situation.pasteInput).fill(pasted);
  await addInfo.getByTestId(testIds.situation.submit("paste")).click();
  await waitForJudgmentReady(page);
  await openSheet(page, "collapsed");
  await waitForJudgment(page);
}

async function waitForJudgment(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
}

// 半分まで引き上げ、図の上端から下端までが画面に収まることを確かめる
async function expectChartInHalfSheet(page: Page): Promise<void> {
  const chart = page.getByTestId(testIds.judgment.resumeChance);
  await expect(chart).toBeVisible();
  await openSheet(page, "half");
  await expect(page.getByTestId(testIds.judgment.sheet)).toHaveAttribute("data-snap", "half");
  await waitForFiniteAnimations(page);
  const box = await chart.boundingBox();
  expect(box, "再開の見込みの図が見つからない").not.toBeNull();
  expect(box?.y ?? 0).toBeGreaterThan(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
  // 半分の段は全部開いた段より低く、地図を残す
  const sheetBox = await page.getByTestId(testIds.judgment.sheet).boundingBox();
  expect(sheetBox?.y ?? 0).toBeGreaterThan(100);
}

async function takeShot(page: Page, name: string): Promise<void> {
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await waitForFiniteAnimations(page);
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: `${screenshotDir}${name}-390x844.png` });
}

test("急病人は規則の短い目安から図を描き、半分の段で図の下端まで見える", async ({ page }) => {
  await judgeWithCause(page, "inCar");
  await expectChartInHalfSheet(page);
  await takeShot(page, "rule-medical");
});

test("知見の無い電力の原因は統計値から図を描き、半分の段で図の下端まで見える", async ({ page }) => {
  await judgeWithCause(page, "power");
  await expectChartInHalfSheet(page);
  await takeShot(page, "statistics-power");
});

test("人身事故は、支障の無い線路の見込みの下にある図も半分の段で下端まで見える", async ({
  page,
}) => {
  await judgeWithCause(page, "person");
  await expect(page.getByTestId(testIds.judgment.trackLine("opposite"))).toBeAttached();
  await expectChartInHalfSheet(page);
});

test("雨の事象でも、半分の段で図の下端まで見える", async ({ page }) => {
  await judgeWithCause(page, { weather: "rain" });
  await expectChartInHalfSheet(page);
});

test("発表の時刻を選ぶと、その時刻から図を描く", async ({ page }) => {
  await openJudgment(page);
  await addAnswers(page, { elapsed: "m10", resume: { time: "first" } });
  await openSheet(page, "collapsed");
  await waitForJudgment(page);
  await expectChartInHalfSheet(page);
});

test("再開しましたの発表を貼ると、初列車待ちから図を描く", async ({ page }) => {
  await judgeWithPaste(page, "人身事故のため運転を見合わせていましたが、運転を再開しました。");
  await expectChartInHalfSheet(page);
});

test("原因が分からず見込みが無いときは、図の代わりの境目の時刻が半分の段で見える", async ({
  page,
}) => {
  await judgeWithCause(page, null);
  await expect(page.getByTestId(testIds.judgment.resumeChance)).toHaveCount(0);
  const time = page.getByTestId(testIds.judgment.breakEvenTime);
  await openSheet(page, "half");
  await waitForFiniteAnimations(page);
  await expect(time).toBeInViewport();
});

test("線路に降りる案内のときは図を出さない", async ({ page }) => {
  await judgeWithPaste(
    page,
    "人身事故のため、運転を見合わせています。これから線路に降りて、最寄り駅まで歩いてご案内します。",
  );
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toHaveText(
    "係員の案内に従う",
  );
  await openSheet(page, "half");
  await expect(page.getByTestId(testIds.judgment.resumeChance)).toHaveCount(0);
});

test("駅と駅の間の車内では、車内で待つ案内を出し、図を出さない", async ({ page }) => {
  await openEntry(page);
  await chooseBetweenStations(page, "JR神戸線", "大阪", "塚本");
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await finishEntry(page, {
    cause: "person",
    protection: "notHeard",
    elapsed: "m10",
    resume: "unknown",
  });
  await openSheet(page, "collapsed");
  await waitForJudgment(page);
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toHaveText("車内で待つ");
  await openSheet(page, "half");
  await expect(page.getByTestId(testIds.judgment.resumeChance)).toHaveCount(0);
});

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import {
  addAnswers,
  expectJudgmentOpened,
  finishEntry,
  openAddInfo,
  waitForJudgmentReady,
} from "../support/add-info.ts";
import { chooseBetweenStations } from "../support/entry.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 入口ではいる所と行き先の後に、原因、止まってからの分、受信の放送、乗車券、再開見込みを順に聞く
// どの問いも分からないで次へ進め、最後まで答えたら判断を出す
// 後から分かったことは、判断の画面の「情報を追加する」から足す。決定論モードの agent とダミーの内容で確かめる

const screenshotDir = fileURLToPath(new URL("../screenshots/add-info/", import.meta.url));

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(150_000);

async function capture(page: Page, name: string): Promise<void> {
  await waitForFiniteAnimations(page);
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: `${screenshotDir}${name}.png` });
}

// 大阪駅にいて三ノ宮へ向かう。いる所と行き先を答え、原因の問いまで進む
async function enterOsakaToSannomiya(page: Page): Promise<void> {
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
  await expectStage(page, "cause");
}

function expectStage(page: Page, stage: string) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

// 判断の中身の要約。結論と選択肢の並びを、足す前と後で比べる
async function readJudgment(page: Page): Promise<string> {
  const conclusion = await page.getByTestId(testIds.judgment.conclusion).textContent();
  const options = await page.locator("[data-testid^='judgment-option-']").allTextContents();
  return [conclusion, ...options].join("|");
}

test("入口の問いに全部「分からない」を押すと、問いを順に進み、最後に判断を出す", async ({
  page,
}) => {
  await enterOsakaToSannomiya(page);
  // 行き先を答えただけでは判断を出さない
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/$/);
  await capture(page, "entry-1-cause");
  await page.getByTestId(testIds.start.cause("unknown")).click();
  // 駅にいる人には受信の放送を聞かない
  await expectStage(page, "elapsed");
  await capture(page, "entry-3-elapsed");
  await page.getByTestId(testIds.start.elapsed("unknown")).click();
  await expectStage(page, "resume");
  // 乗車券は再開見込みの問いの上に並び、既定は分からない
  await expect(page.getByTestId(testIds.start.ticket("unknown"))).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await capture(page, "entry-4-ticket-resume");
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expectJudgmentOpened(page);
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible();
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toContainText(
    "推定であり、公式発表を優先してください",
  );
  await openSheet(page, "collapsed");
  await capture(page, "judgment");
});

test("駅と駅の間の車内では、原因の後に受信の放送を聞き、覚えていないで次へ進む", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await chooseBetweenStations(page, "JR神戸線", "大阪", "塚本");
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await expectStage(page, "cause");
  await page.getByTestId(testIds.start.cause("unknown")).click();
  await expectStage(page, "protection");
  await capture(page, "entry-2-protection");
  await page.getByTestId("start-protection-unsure").click();
  await expectStage(page, "elapsed");
  await page.getByTestId(testIds.start.elapsed("unknown")).click();
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expectJudgmentOpened(page);
});

test("入口で原因を答えると、情報を追加するは原因の選択肢を最初に出さず、入口の答えを札で出す", async ({
  page,
}) => {
  await enterOsakaToSannomiya(page);
  await finishEntry(page, { cause: "person", elapsed: "m10" });
  const addInfo = await openAddInfo(page);
  await expect(addInfo.getByTestId(testIds.situation.answer("cause"))).toHaveText("人身事故");
  await expect(addInfo.locator("[data-testid^='situation-cause-']")).toHaveCount(0);
  await expect(addInfo.getByTestId(testIds.situation.cue("resumed"))).toBeVisible();
  await expect(addInfo.getByTestId(testIds.situation.answer("elapsed"))).toContainText("約10分");
  // 分からないと答えた問いは、後から足せる項目として残す
  await expect(addInfo.getByTestId(testIds.situation.item("resume"))).toBeVisible();
  await capture(page, "add-info");
});

test("入口で原因を分からないとし、後から原因を足すと、原因の選択肢を最初に出さず、札から選び直せる", async ({
  page,
}) => {
  await enterOsakaToSannomiya(page);
  await finishEntry(page);

  // 原因が決まっていなければ、原因を先に聞く
  let addInfo = await openAddInfo(page);
  await expect(addInfo.getByTestId(testIds.situation.causeOption("person"))).toBeVisible();
  await expect(addInfo.locator("[data-testid^='situation-cue-']")).toHaveCount(0);

  const before = await readJudgment(page);
  await addAnswers(page, { cause: "person" });
  expect(await readJudgment(page)).not.toBe(before);

  // 原因が決まると、原因の選択肢は出さず、原因の札と放送の手がかりを出す
  addInfo = await openAddInfo(page);
  const chip = addInfo.getByTestId(testIds.situation.answer("cause"));
  await expect(chip).toHaveText("人身事故");
  await expect(addInfo.locator("[data-testid^='situation-cause-']")).toHaveCount(0);
  await expect(addInfo.getByTestId(testIds.situation.cue("resumed"))).toBeVisible();
  await expect(addInfo.getByTestId(testIds.situation.item("elapsed"))).toBeVisible();
  await expect(addInfo.getByTestId(testIds.situation.item("section"))).toBeVisible();
  await capture(page, "add-info-later");

  // 札を押すと原因を選び直せる
  await chip.click();
  await expect(addInfo.getByTestId(testIds.situation.causeOption("vehicle"))).toBeVisible();
  await addInfo.getByTestId(testIds.situation.back).click();
  await expect(addInfo.getByTestId(testIds.situation.causeOption("vehicle"))).toHaveCount(0);

  // 止まってからの分を足すと、その答えも札に残る
  await addAnswers(page, { elapsed: "m10" });
  addInfo = await openAddInfo(page);
  await expect(addInfo.getByTestId(testIds.situation.answer("elapsed"))).toContainText("約10分");
  await expect(addInfo.getByTestId(testIds.situation.item("elapsed"))).toHaveCount(0);
});

test("地図で両端の駅を押して見合わせ区間を足すと、区間を描き、判断が変わる", async ({ page }) => {
  await enterOsakaToSannomiya(page);
  await finishEntry(page);
  const map = page.getByTestId(testIds.judgment.map);
  await expect(map).toHaveAttribute("data-blocked", "false");
  const before = await readJudgment(page);

  const addInfo = await openAddInfo(page);
  await addInfo.getByTestId(testIds.situation.item("section")).click();
  await expect(page.getByTestId(testIds.judgment.sheet)).toHaveAttribute("data-snap", "collapsed");
  const banner = page.getByTestId(mapTestIds.sectionPick);
  await expect(banner).toContainText("端の駅を押す");
  await expect(page.getByTestId(mapTestIds.sectionPickStation("尼崎"))).toBeInViewport();
  await page.waitForTimeout(1_000);
  await capture(page, "section-pick");
  await page.getByTestId(mapTestIds.sectionPickStation("大阪")).click();
  await expect(banner).toContainText("もう一方");
  await page.getByTestId(mapTestIds.sectionPickStation("尼崎")).click();
  await expect(banner).toHaveCount(0);
  await waitForJudgmentReady(page);

  await expect(map).toHaveAttribute("data-blocked", "true");
  // 区間が分かると、区間を避けて尼崎の先へ回る経路を選択肢に足す
  const after = await readJudgment(page);
  expect(after).not.toBe(before);
  expect(after).toContain("JR東西線");
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await page.getByTestId(mapTestIds.viewToggle).click();
  await expect(map).toHaveAttribute("data-view", "overview");
  await expect(page.getByTestId(mapTestIds.blockedTag)).toHaveText("見合わせ 大阪〜尼崎", {
    timeout: 15_000,
  });
  await page.waitForTimeout(1_000);
  await capture(page, "section");

  const reopened = await openAddInfo(page);
  await expect(reopened.getByTestId(testIds.situation.answer("section"))).toContainText(
    "大阪〜尼崎",
  );
});

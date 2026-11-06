import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { chooseTrainDirection } from "../support/entry.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 止まっている区間の描き方。区間の根拠は利用者が持ち込んだ発表だけにする
// 発表に区間が無いときは区間を描かず、発表で確かめるよう添える。決定論モードの agent とダミーの内容で確かめる

const screenshotDir = fileURLToPath(new URL("../screenshots/blocked-section/", import.meta.url));

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(150_000);

async function capture(page: Page, name: string): Promise<void> {
  await waitForFiniteAnimations(page);
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: `${screenshotDir}${name}.png` });
}

// 大阪から JR 神戸線で三ノ宮へ向かう途中、大阪と塚本の間で人身事故により止まった想定
async function startBetweenStations(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await chooseTrainDirection(page, "JR神戸線", "神戸");
  await page.getByTestId(testIds.start.positionBetween).click();
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "cause");
  await page.getByTestId(testIds.start.cause("person")).click();
  await page.getByTestId(testIds.start.elapsed("m10")).click();
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready", {
    timeout: 30_000,
  });
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
}

test("発表に区間が無い駅の間の車内では区間を描かず、区間は発表で確かめると添え、発表を貼ると線路に沿った区間と札を描く", async ({
  page,
}) => {
  await startBetweenStations(page);
  const map = page.getByTestId(testIds.judgment.map);

  // 利用者がいることだけを根拠に区間を作らない。区間の線と札を出さず、発表で確かめるよう添える
  await expect(map).toHaveAttribute("data-blocked", "false");
  await expect(map).toHaveAttribute("data-blocked-points", "0");
  await expect(page.getByTestId(mapTestIds.blockedTag)).toHaveCount(0);
  const note = page.getByTestId(mapTestIds.sectionNote);
  await expect(note).toBeVisible();
  await expect(note).toContainText("区間は発表で確かめる");
  // 上部の札は人身事故なので見合わせのまま。判断の文には駅の位置から作った区間を書かない
  await expect(page.getByTestId(testIds.judgment.statusChip)).toContainText("見合わせ");
  await expect(page.getByTestId(testIds.judgment.conclusion)).not.toContainText("大阪〜三ノ宮");
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toContainText(
    "推定であり、公式発表を優先してください",
  );
  await capture(page, "no-announcement");

  // 案内の文を押すと、シートを開いて発表を貼る欄へ移る
  const action = page.getByTestId(mapTestIds.sectionNoteAction);
  await expect(action).toBeVisible();
  await action.click();
  await expect(page.getByTestId(testIds.judgment.sheet)).toHaveAttribute("data-snap", "full");
  const addInfo = page.getByTestId(testIds.judgment.addInfo);
  await expect(addInfo).toBeInViewport();

  // 区間のある発表を貼ると、その区間だけを強く描き、「見合わせ 大阪〜三ノ宮」の札を付ける
  await addInfo.getByTestId(testIds.situation.tab("paste")).click();
  await addInfo
    .getByTestId(testIds.situation.pasteInput)
    .fill("人身事故のため、大阪〜三ノ宮間で運転を見合わせています。");
  await addInfo.getByTestId(testIds.situation.submit("paste")).click();
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready", {
    timeout: 30_000,
  });
  await expect(map).toHaveAttribute("data-blocked", "true");
  await expect(note).toHaveCount(0);
  // 線路の形から切り出すので、途中の 11 駅を結ぶ折れ線より点がずっと多い
  const points = Number(await map.getAttribute("data-blocked-points"));
  expect(points).toBeGreaterThan(40);

  // 全体を見ると、区間の中ほどに札が出る
  await openSheet(page, "collapsed");
  await page.getByTestId(mapTestIds.viewToggle).click();
  await expect(map).toHaveAttribute("data-view", "overview");
  const tag = page.getByTestId(mapTestIds.blockedTag);
  await expect(tag).toBeVisible({ timeout: 15_000 });
  await expect(tag).toHaveText("見合わせ 大阪〜三ノ宮");
  await page.waitForTimeout(1_000);
  await capture(page, "announced");
});

test("その列車だけが止まるときは、区間も区間を確かめる案内も出さない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await chooseTrainDirection(page, "JR神戸線", "神戸");
  await page.getByTestId(testIds.start.positionBetween).click();
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await page.getByTestId(testIds.start.cause("inCar")).click();
  await page.getByTestId(testIds.start.elapsed("m10")).click();
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  const map = page.getByTestId(testIds.judgment.map);
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(map).toHaveAttribute("data-blocked", "false");
  await expect(page.getByTestId(mapTestIds.blockedTag)).toHaveCount(0);
  await expect(page.getByTestId(mapTestIds.sectionNote)).toHaveCount(0);
});

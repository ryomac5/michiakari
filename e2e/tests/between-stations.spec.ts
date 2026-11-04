import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 入口で「電車の中・駅と駅の間」を選んだ人の判断
// 追加の問いは出さず、次の駅・種別・前の列車を既定値で置いて判断を出す。前提は判断の画面のチップで直せる
// 結論は次の駅に着いてからの行動で書き、「あと N 分」で始めない。決定論モードの agent とダミーの内容で確かめる

const kobeLine = "大阪|jr-west.東海道線|JR神戸線";
const toKobe = `${kobeLine}>jr-west.東海道線.神戸`;
const screenshotRoot = fileURLToPath(new URL("../screenshots/between-stations/", import.meta.url));

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(150_000);

async function capture(page: Page, theme: string, name: string): Promise<void> {
  await waitForFiniteAnimations(page);
  const dir = `${screenshotRoot}${theme}/`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}${name}.png` });
}

// 大阪から JR 神戸線で三ノ宮へ向かう途中、塚本の手前で止まった想定。いまどこの段まで進める
async function reachPositionStep(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.originSearch).fill("大阪");
  await page.getByTestId(testIds.start.originOption("大阪")).click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "station");
  await page.getByTestId(testIds.start.line(kobeLine)).click();
  await page.getByTestId(testIds.start.direction(toKobe)).click();
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await expect(page.getByTestId(testIds.start.positionBetween)).toBeVisible();
}

// 駅と駅の間を選び、人身事故・10 分くらい・見込みは言っていないで判断を始める
async function startBetweenStations(page: Page): Promise<void> {
  await page.getByTestId(testIds.start.positionBetween).click();
  // 次の駅・種別・前の列車は問わず、そのまま様子の段に進む
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "cause");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("塚本");
  await page.getByTestId(testIds.start.cause("person")).click();
  await page.getByTestId(testIds.start.elapsed("m10")).click();
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`駅と駅の間 ${theme}`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([
        { name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" },
        { name: "theme", value: theme, url: baseURL ?? "" },
      ]);
    });

    test("駅と駅の間を選ぶと、追加の問いなしで判断が出て、見出しに既定の次の駅の名前が入る", async ({
      page,
    }) => {
      await reachPositionStep(page);
      await capture(page, theme, "01-entry-position");
      await startBetweenStations(page);

      // 見出しは次の駅に着いてからの行動で、「あと N 分」で始まらない
      const headline = page.getByTestId(testIds.judgment.conclusionHeadline);
      await expect(headline).toContainText("塚本");
      await expect(headline).not.toHaveText(/^あと\s?\d+\s?分/);
      await expect(headline).not.toContainText(/まで待って/);

      // 前提のチップは既定値の見た目で、前の列車はふだんの運転から推し量った並びになる
      const next = page.getByTestId(testIds.judgment.trainPositionChip("next"));
      await expect(next).toContainText("塚本");
      await expect(next).toHaveAttribute("data-source", "default");
      const own = page.getByTestId(testIds.judgment.trainPositionChip("own"));
      await expect(own).toContainText("普通に乗車");
      await expect(own).toHaveAttribute("data-source", "default");
      const ahead = page.getByTestId(testIds.judgment.trainPositionChip("ahead"));
      await expect(ahead).toContainText("普通・普通・普通");
      await expect(ahead).toContainText("ふだんの運転から推定");
      await expect(ahead).toHaveAttribute("data-source", "default");
      await expect(page.getByTestId(testIds.judgment.trainPositionHint)).toContainText(
        "前の列車の種類が分かると",
      );
      await expect(page.getByTestId(testIds.judgment.disclaimer)).toContainText(
        "推定であり、公式発表を優先してください",
      );

      await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
        timeout: 30_000,
      });
      await capture(page, theme, "02-judgment-chips-closed");

      // チップを押すと、その場で直せる選択が開く
      await ahead.click();
      const editor = page.getByTestId(testIds.judgment.trainPositionEditor);
      await expect(editor).toHaveAttribute("data-kind", "ahead");
      await expect(editor).toContainText("列車走行位置の画面で確かめられます");
      await capture(page, theme, "03-judgment-chips-open");
    });
  });
}

test("判断の画面で前の列車のチップを押し、快速と普通を並べて直すと、判断が出し直され、理由に種別の事情が入る", async ({
  page,
}) => {
  await reachPositionStep(page);
  await startBetweenStations(page);

  // 近い順に快速、普通と押して並べ、この前提で判断し直す
  await page.getByTestId(testIds.judgment.trainPositionChip("ahead")).click();
  await page.getByTestId(testIds.judgment.trainPositionAheadAdd("rapid")).click();
  await page.getByTestId(testIds.judgment.trainPositionAheadAdd("local")).click();
  await expect(page.locator("[data-testid^='judgment-train-position-ahead-item-']")).toHaveCount(2);
  await page.getByTestId(testIds.judgment.trainPositionApply).click();

  // 直したチップは確定した見た目になり、推定の注記が消える
  const ahead = page.getByTestId(testIds.judgment.trainPositionChip("ahead"));
  await expect(ahead).toHaveAttribute("data-source", "user");
  await expect(ahead).toContainText("快速・普通");
  await expect(ahead).not.toContainText("推定");
  await expect(page.getByTestId(testIds.judgment.trainPositionHint)).toHaveCount(0);

  // 判断が出し直され、理由に「前の快速が塚本に入れない」事情が入る
  await openSheet(page, "half");
  const reason = page.getByTestId(testIds.judgment.conclusionReason).first();
  await expect(reason).toContainText("前の快速が塚本に入れないため", { timeout: 30_000 });
  await expect(reason).toContainText("再開のあと");
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready");
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toContainText("塚本");
});

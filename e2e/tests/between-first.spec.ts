import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { searchStationPair } from "../support/entry.ts";
import {
  betweenTsukamotoAmagasaki,
  expectStage,
  findCanvasPointNear,
  panTo,
  readZoom,
  waitForMapStill,
} from "../support/map-view.ts";
import { expect, test } from "../support/test.ts";

// 最初の段で「駅と駅の間で止まっている」を 1 回押すと、路線と方面を聞かずに駅の間を選ぶ段へ進む
// 駅の間は、地図の線を押すか、両側の 2 つの駅名で選ぶ。はいで確定して行き先の段へ進む

const screenshotDir = fileURLToPath(new URL("../screenshots/between-first/", import.meta.url));

test.setTimeout(120_000);

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" }]);
});

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(size, () => {
    test.use({ viewport });

    test("駅と駅の間で止まっているを押すと駅の間の段へ進み、塚本と尼崎の間の線を押して確定すると行き先へ進む", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
        timeout: 30_000,
      });
      await expectStage(page, "position");
      // 最初の段の選び方は、駅にいると駅と駅の間で止まっているの 2 つ。検索と現在地も同じ段に置く
      await expect(page.getByTestId(testIds.start.positionStation)).toHaveText("駅にいる");
      await expect(page.getByTestId(testIds.start.positionTrain)).toHaveText(
        "駅と駅の間で止まっている",
      );
      await expect(page.getByTestId(testIds.start.originSearch)).toBeVisible();
      await expect(page.getByTestId(testIds.start.gpsLocate)).toBeVisible();
      await expect(page.getByTestId(testIds.start.replayLink)).toBeVisible();
      await waitForMapStill(page);
      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: `${screenshotDir}position-${size}.png` });
      await page.getByTestId(testIds.start.introClose).click();

      // 1 回押すと駅の間の段へ進む。路線と方面の段は出さない
      await page.getByTestId(testIds.start.positionTrain).click();
      await expectStage(page, "between");
      await expect(page.getByTestId(testIds.start.sheet)).toContainText("止まっている所の線を押す");
      await expect(page.locator("[data-testid^='start-line-']")).toHaveCount(0);
      await expect(page.locator("[data-testid^='start-direction-']")).toHaveCount(0);
      await waitForMapStill(page);
      // 地図は駅の印が出る倍率まで寄せ、線を押せば駅の間を選べる
      expect(await readZoom(page)).toBeGreaterThanOrEqual(12.5);
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-detail", "stations");
      await page.screenshot({ path: `${screenshotDir}between-${size}.png` });

      // 寄せ直さずに、地図を動かして線を押す
      await page.locator(".maplibregl-canvas").focus();
      const point = await panTo(page, betweenTsukamotoAmagasaki, {
        x: viewport.width / 2,
        y: viewport.height * 0.25,
      });
      expect(await readZoom(page)).toBeGreaterThanOrEqual(12.5);
      const open = await findCanvasPointNear(page, point);
      await page.mouse.click(open.x, open.y);
      await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveText(
        "JR神戸線の塚本〜尼崎の間ですか",
      );
      await expectStage(page, "between");
      await page.screenshot({ path: `${screenshotDir}between-question-${size}.png` });

      // はいで確定し、行き先の段へ進む
      await page.getByTestId(testIds.start.gpsConfirm).click();
      await expectStage(page, "destination");
      await expect(page.getByTestId(testIds.start.trainSegment)).toHaveCount(0);

      // 戻るは 1 段ずつ引く
      await page.getByTestId(testIds.start.back).click();
      await expectStage(page, "between");
      await page.getByTestId(testIds.start.back).click();
      await expectStage(page, "position");
    });

    test("2 つの駅名で塚本と尼崎の間を選び、行き先まで進んで、戻るで 1 段ずつ引ける", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
        timeout: 30_000,
      });
      await page.getByTestId(testIds.start.positionTrain).click();
      await expectStage(page, "between");

      // 2 駅を通る路線が無ければ、その旨を出して選び直させる
      await searchStationPair(page, "塚本", "難波");
      await expect(page.getByTestId(testIds.start.betweenPairNone)).toBeVisible();
      await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveCount(0);
      await page.getByTestId(testIds.start.betweenSecond).click();
      await expect(page.getByTestId(testIds.start.betweenPairNone)).toHaveCount(0);

      await page.getByTestId(testIds.start.betweenSecondSearch).fill("尼崎");
      await page.getByTestId(testIds.start.betweenSecondOption("尼崎")).click();
      await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveText(
        "JR神戸線の塚本〜尼崎の間ですか",
      );
      await page.getByTestId(testIds.start.gpsConfirm).click();
      await expectStage(page, "destination");
      await page.getByTestId(testIds.start.destinationSearch).fill("三ノ宮");
      await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
      await expectStage(page, "cause");
      await expect(page.getByTestId(testIds.start.trip)).toContainText("尼崎");
      await expect(page.getByTestId(testIds.start.trip)).toContainText("駅と駅の間");
      for (const stage of ["destination", "between", "position"]) {
        await page.goBack();
        await expectStage(page, stage);
      }
    });
  });
}

test.describe("並走する路線", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("2 つの駅名の間に駅があれば駅の間の並びを、並走する路線があればどれも出して選ばせる", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
      timeout: 30_000,
    });
    await page.getByTestId(testIds.start.positionTrain).click();
    await searchStationPair(page, "天王寺", "新今宮");
    const choices = page.locator("[data-testid^='start-gps-choice-']");
    await expect(choices).toHaveText([
      "JR環状線の天王寺〜新今宮の間",
      "JR大和路線の天王寺〜新今宮の間",
    ]);
    await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveCount(0);

    // 1 つ目の駅を押すと、2 駅とも選び直す
    await page.getByTestId(testIds.start.betweenFirst).click();
    await searchStationPair(page, "大阪", "尼崎");
    await expect(choices).toHaveText(["JR神戸線の大阪〜塚本の間", "JR神戸線の塚本〜尼崎の間"]);
    await choices.filter({ hasText: "塚本〜尼崎" }).click();
    await expectStage(page, "destination");
  });
});

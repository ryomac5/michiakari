import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  expectStage,
  panTo,
  projectOnPage,
  readZoom,
  waitForMapStill,
  zoomOn,
} from "../support/map-view.ts";
import { expect, test } from "../support/test.ts";

// 駅どうしが近い大阪〜福島で、環状線の線の中ほどを押すと駅の間を選べ、駅の印を押すと駅を選べる
// 線の中ほどは西梅田の札の下にも掛かる。札の下の線を押しても駅の間にする

const screenshotDir = fileURLToPath(new URL("../screenshots/osaka-line-tap/", import.meta.url));
// 描いた大阪環状線を大阪と福島で切り出した線の、長さの半分の点
const loopMiddle: [number, number] = [135.491197, 34.699714];
// 大阪を出た JR神戸線は、福島の手前まで環状線に沿って描かれている。並ぶ路線は近い順に並べ、押した環状線を先頭に出す
// 梅田の地下を通る線の「JR神戸線の大阪〜福島」は実在しない駅の間なので出さない
const osakaPosition: [number, number] = [135.49588, 34.70216];
const loopChoice = "between:jr-west.大阪環状線:";
const loopLabel = "JR環状線の福島〜大阪の間";

test.setTimeout(120_000);

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" }]);
});

async function openMap(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await expectStage(page, "position");
  // 価値の 3 行は地図の上端を覆うので、線を押す前に閉じる
  await page.getByTestId(testIds.start.introClose).click();
  await waitForMapStill(page);
}

// 大阪のあたりは引いた地図ではエリアの丸が受け持つので、キーで駅の印が出る倍率まで寄せる
async function zoomNearOsaka(
  page: import("@playwright/test").Page,
  viewport: { width: number; height: number },
  target: [number, number] = loopMiddle,
) {
  await openMap(page);
  await page.locator(".maplibregl-canvas").focus();
  await zoomOn(page, target, 13);
  await panTo(page, target, { x: viewport.width / 2, y: viewport.height * 0.3 });
  await expectStage(page, "position");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-detail", "stations");
}

// 線の中ほどの画面の点。上部の帯とシートに隠れていないことも確かめる
async function locateLoopMiddle(page: import("@playwright/test").Page) {
  const point = await projectOnPage(page, loopMiddle);
  const sheetTop = (await page.getByTestId(testIds.start.sheet).boundingBox())?.y ?? 0;
  expect(point.y).toBeGreaterThan(80);
  expect(point.y).toBeLessThan(sheetTop);
  expect(point.x).toBeGreaterThan(0);
  return point;
}

async function expectLoopChoices(page: import("@playwright/test").Page) {
  const choices = page.locator("[data-testid^='start-gps-choice-']");
  await expect(choices.first()).toHaveText(loopLabel);
  await expect(choices.first()).toHaveAttribute("data-testid", new RegExp(`${loopChoice}`));
  expect(await choices.count()).toBeLessThanOrEqual(3);
  await expect(choices.filter({ hasText: "JR神戸線の大阪〜福島" })).toHaveCount(0);
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(size, () => {
    test.use({ viewport });

    test("駅の間の段で、大阪〜福島の環状線の線の中ほどを押すと、その駅の間を選べる", async ({
      page,
    }) => {
      await openMap(page);
      await page.getByTestId(testIds.start.positionTrain).click();
      await expectStage(page, "between");
      // 駅の間の段は、駅の印が出る倍率まで寄せてから押す
      await expect.poll(() => readZoom(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(12.5);
      await waitForMapStill(page);

      // 寄せたままの地図で、線の中ほどを押す。何も起きないままにしない
      const point = await locateLoopMiddle(page);
      await page.mouse.click(point.x, point.y);
      await expectLoopChoices(page);
      await expectStage(page, "between");
      await waitForMapStill(page);
      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: `${screenshotDir}between-${size}.png` });

      // 環状線を選ぶと、行き先の段へ進む
      await page.locator(`[data-testid^='start-gps-choice-${loopChoice}']`).click();
      await expectStage(page, "destination");
    });

    test("最初の段で、寄った地図の大阪〜福島の環状線の線の中ほどを押すと、その駅の間を選べる", async ({
      page,
    }) => {
      await zoomNearOsaka(page, viewport);
      // 寄った地図で線の中ほどを押すと、駅の間を尋ねる。段は最初の段のまま
      const point = await locateLoopMiddle(page);
      await page.mouse.click(point.x, point.y);
      await expectLoopChoices(page);
      await expectStage(page, "position");
      await waitForMapStill(page);
      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: `${screenshotDir}position-${size}.png` });
    });

    test("最初の段で、寄った地図の大阪の印の中心を押すと、大阪の駅にいるとして行き先へ進む", async ({
      page,
    }) => {
      await zoomNearOsaka(page, viewport, osakaPosition);
      const osaka = page.getByTestId(testIds.start.place("osaka"));
      const box = await osaka.boundingBox();
      if (!box) throw new Error("大阪の印がありません");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expectStage(page, "destination");
      await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveCount(0);
    });
  });
}

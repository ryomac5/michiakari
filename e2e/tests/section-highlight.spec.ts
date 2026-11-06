import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
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

// 線を押して駅の間の候補が出たら、候補の区間を地図で光らせる
// 大阪〜福島の環状線の中ほどを押すと、環状線と JR神戸線の 2 件が出て、先頭の環状線がいちばん強く光る

const screenshotRoot = fileURLToPath(new URL("../screenshots/section-highlight/", import.meta.url));
// 描いた大阪環状線を大阪と福島で切り出した線の、長さの半分の点
const loopMiddle: [number, number] = [135.491197, 34.699714];
const loopChoice = "between:jr-west.大阪環状線:";
const choiceLocator = "[data-testid^='start-gps-choice-']";

test.setTimeout(120_000);

async function openMap(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await expectStage(page, "position");
  await page.getByTestId(testIds.start.introClose).click();
  await waitForMapStill(page);
}

// 線の中ほどを押し、候補が 2 件出るまで待つ
async function tapLoopMiddle(page: Page) {
  const point = await projectOnPage(page, loopMiddle);
  const sheetTop = (await page.getByTestId(testIds.start.sheet).boundingBox())?.y ?? 0;
  expect(point.y).toBeGreaterThan(80);
  expect(point.y).toBeLessThan(sheetTop);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(choiceLocator)).toHaveCount(2);
}

async function readChoiceKey(page: Page, index: number): Promise<string> {
  const testId = await page.locator(choiceLocator).nth(index).getAttribute("data-testid");
  return (testId ?? "").replace("start-gps-choice-", "");
}

// 押した線の中ほどが、上部の帯とシートの間に見えている
async function expectAboveSheet(page: Page) {
  const point = await projectOnPage(page, loopMiddle);
  const sheetTop = (await page.getByTestId(testIds.start.sheet).boundingBox())?.y ?? 0;
  expect(point.y).toBeGreaterThan(60);
  expect(point.y).toBeLessThan(sheetTop);
}

// 光りの層に描けた区間の数と、いちばん強い区間
async function expectSections(page: Page, count: number, focus: string) {
  const map = page.getByTestId(testIds.start.map);
  await expect(map).toHaveAttribute("data-section-count", String(count));
  await expect(map).toHaveAttribute("data-section-focus", focus);
}

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    { width: 375, height: 667 },
    { width: 390, height: 844 },
  ]) {
    const size = `${viewport.width}x${viewport.height}`;
    test.describe(`${theme} ${size}`, () => {
      test.use({ viewport });
      test.beforeEach(async ({ context, baseURL }) => {
        await context.addCookies([
          { name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" },
          { name: "theme", value: theme, url: baseURL ?? "" },
        ]);
      });

      test("最初の段で線を押すと候補の区間が光り、2 件目に注目すると強さが入れ替わる", async ({
        page,
      }) => {
        await openMap(page);
        await page.locator(".maplibregl-canvas").focus();
        await zoomOn(page, loopMiddle, 13);
        await panTo(page, loopMiddle, { x: viewport.width / 2, y: viewport.height * 0.3 });
        await expect(page.getByTestId(testIds.start.map)).toHaveAttribute(
          "data-detail",
          "stations",
        );
        await expectSections(page, 0, "");

        await tapLoopMiddle(page);
        // 押した点に波紋の印が一瞬だけ出る
        await expect(page.getByTestId(testIds.start.tapRipple)).toHaveCount(1);
        await expect(page.getByTestId(testIds.start.tapRipple)).toHaveCount(0);
        const first = await readChoiceKey(page, 0);
        const second = await readChoiceKey(page, 1);
        expect(first.startsWith(loopChoice)).toBe(true);
        await expectSections(page, 2, first);
        await expectStage(page, "position");
        await waitForMapStill(page);
        // 光らせた区間はシートに隠さず、地図の見える所に置く
        await expectAboveSheet(page);
        const dir = `${screenshotRoot}${theme}/`;
        mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: `${dir}${size}-tap.png` });

        // 2 件目に指を置くかフォーカスすると、その区間がいちばん強く光る
        await page.locator(choiceLocator).nth(1).focus();
        await expectSections(page, 2, second);
        await waitForMapStill(page);
        await page.screenshot({ path: `${dir}${size}-focus-second.png` });
        await page.locator(choiceLocator).nth(1).blur();
        await expectSections(page, 2, first);
        await page.locator(choiceLocator).nth(1).hover();
        await expectSections(page, 2, second);
      });
    });
  }
}

test.describe("確定と戻る", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" }]);
  });

  test("駅の間を確定すると選んだ区間は光ったまま残り、戻ると光りが消える", async ({ page }) => {
    await openMap(page);
    await page.getByTestId(testIds.start.positionTrain).click();
    await expectStage(page, "between");
    await expect.poll(() => readZoom(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(12.5);
    await waitForMapStill(page);
    await tapLoopMiddle(page);
    const first = await readChoiceKey(page, 0);
    await expectSections(page, 2, first);

    // 違うを押さずに候補を選ぶと、選んだ区間だけが光ったまま行き先の段へ進む
    await page.locator(choiceLocator).first().click();
    await expectStage(page, "destination");
    await waitForMapStill(page);
    await expectSections(page, 1, first);

    await page.getByTestId(testIds.start.back).click();
    await expectStage(page, "between");
    await waitForMapStill(page);
    await expectSections(page, 0, "");
  });
});

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  expectStage,
  findCanvasPointNear,
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
        // フォーカスしたまま 1 件目に指を置くと 1 件目が強くなり、指が離れるとフォーカスの 2 件目に戻る
        await page.locator(choiceLocator).nth(0).hover();
        await expectSections(page, 2, first);
        await page.mouse.move(viewport.width / 2, 20);
        await expectSections(page, 2, second);
        await page.locator(choiceLocator).nth(1).blur();
        await expectSections(page, 2, first);
        await page.locator(choiceLocator).nth(1).hover();
        await expectSections(page, 2, second);
      });
    });
  }
}

// 描いた環状線の大阪〜福島の頂点のうち、印に掛からずシートの上に見えている点
async function findLoopPointOnCanvas(page: Page) {
  const vertices: [number, number][] = [
    loopMiddle,
    [135.4923, 34.70039],
    [135.49026, 34.69914],
    [135.48743, 34.69759],
    [135.49456, 34.70144],
  ];
  const sheetTop = (await page.getByTestId(testIds.start.sheet).boundingBox())?.y ?? 0;
  for (const vertex of vertices) {
    const point = await projectOnPage(page, vertex);
    if (point.y < 60 || point.y > sheetTop) continue;
    const tag = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point);
    if (tag === "CANVAS") return point;
  }
  throw new Error("押せる環状線の点がありません");
}

test.describe("手で動かさない地図", () => {
  test.use({ viewport: { width: 375, height: 667 } });
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" }]);
  });

  test("引いた地図の線を押して寄せた後、手で動かさずに線を押しても、引かずに押した点が見える所に残る", async ({
    page,
  }) => {
    await openMap(page);
    // 引いた地図で大阪〜福島のあたりの線を押すと、段はそのままで候補の区間を光らせ、候補が入る所まで寄る
    // キーや指では地図を動かさない
    const farZoom = await readZoom(page);
    expect(farZoom).toBeLessThan(12.5);
    const far = await findCanvasPointNear(page, await projectOnPage(page, loopMiddle));
    await page.mouse.click(far.x, far.y);
    await waitForMapStill(page);
    await expectStage(page, "position");
    expect(await readZoom(page)).toBeGreaterThanOrEqual(farZoom - 0.01);
    await expect(page.getByTestId(testIds.start.map)).toHaveAttribute(
      "data-section-focus",
      /^between:/,
    );

    // 寄せた倍率によっては、押せる幅に入る路線が 3 件になる
    // 寄せた後も駅の印の倍率に届かなければ、もう一度押したときも候補を収め直す。どちらでも引かない
    const zoom = await readZoom(page);
    const point = await findLoopPointOnCanvas(page);
    const sheetTop = (await page.getByTestId(testIds.start.sheet).boundingBox())?.y ?? 0;
    expect(point.y).toBeLessThan(sheetTop);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator(choiceLocator).filter({ hasText: "JR環状線" })).toHaveCount(1);
    await waitForMapStill(page);
    const count = await page.locator(choiceLocator).count();
    await expectSections(page, count, await readChoiceKey(page, 0));
    // 候補が出てシートが伸びても、段の寄せ方で引かず、押した点をシートの上に残す
    if (zoom >= 12.5) expect(await readZoom(page)).toBeCloseTo(zoom, 1);
    else expect(await readZoom(page)).toBeGreaterThanOrEqual(zoom - 0.01);
    await expectAboveSheet(page);
  });
});

test.describe("手で動かさない駅の間の段", () => {
  test.use({ viewport: { width: 375, height: 667 } });
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" }]);
  });

  test("駅の間の段で寄せたままの地図の線を押しても、倍率を保ち押した点が見える所に残る", async ({
    page,
  }) => {
    await openMap(page);
    await page.getByTestId(testIds.start.positionTrain).click();
    await expectStage(page, "between");
    await expect.poll(() => readZoom(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(12.5);
    await waitForMapStill(page);
    const zoom = await readZoom(page);
    await tapLoopMiddle(page);
    await waitForMapStill(page);
    expect(await readZoom(page)).toBeCloseTo(zoom, 1);
    await expectAboveSheet(page);
  });
});

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

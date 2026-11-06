import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 最初の地図で駅と駅の間の線を押すと、その駅の間の車内にいるか確かめ、はいで行き先の段へ進む
// 引いた地図で線を押したときは、駅の間を決めずに、まずそのあたりへ寄る

const screenshotDir = fileURLToPath(new URL("../screenshots/line-tap/", import.meta.url));
// 描いた JR神戸線の上で、塚本と尼崎の間にあり、ほかの路線の線から約700m 離れた点。lines.geojson から求めた
const betweenTsukamotoAmagasaki: [number, number] = [135.463484, 34.718828];

test.setTimeout(120_000);

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" }]);
});

function expectStage(page: Page, stage: string) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

async function waitForMapStill(page: Page): Promise<void> {
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-moving", "false", {
    timeout: 15_000,
  });
  await waitForFiniteAnimations(page);
}

async function readZoom(page: Page): Promise<number> {
  return Number(await page.getByTestId(testIds.start.map).getAttribute("data-zoom"));
}

// 地図の中心と倍率から、緯度経度を画面の点に直す。地図は画面いっぱいで、回転も傾きも無い
async function projectOnPage(page: Page, [lon, lat]: [number, number]) {
  const map = page.getByTestId(testIds.start.map);
  const zoom = Number(await map.getAttribute("data-zoom"));
  const [centerLon, centerLat] = ((await map.getAttribute("data-center")) ?? "0,0")
    .split(",")
    .map(Number) as [number, number];
  const world = 512 * 2 ** zoom;
  const toX = (value: number) => ((value + 180) / 360) * world;
  const toY = (value: number) => {
    const rad = (value * Math.PI) / 180;
    return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * world;
  };
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  return {
    x: viewport.width / 2 + toX(lon) - toX(centerLon),
    y: viewport.height / 2 + toY(lat) - toY(centerLat),
  };
}

// 矢印のキーで地図を動かし、点を画面の goal の近くへ寄せる。キーの 1 回で 100px 動く
async function panTo(
  page: Page,
  position: [number, number],
  goal: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  for (let i = 0; i < 40; i++) {
    const point = await projectOnPage(page, position);
    const dx = goal.x - point.x;
    const dy = goal.y - point.y;
    if (Math.abs(dx) < 55 && Math.abs(dy) < 55) return point;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const key = horizontal
      ? dx > 0
        ? "ArrowLeft"
        : "ArrowRight"
      : dy > 0
        ? "ArrowUp"
        : "ArrowDown";
    await page.keyboard.press(key);
    await waitForMapStill(page);
  }
  return projectOnPage(page, position);
}

// 点を画面の中心に置いたまま、キーで 1 段ずつ寄せる
async function zoomOn(page: Page, position: [number, number], target: number): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  for (let i = 0; i < 12 && (await readZoom(page)) < target; i++) {
    await panTo(page, position, center);
    await page.keyboard.press("Equal");
    await waitForMapStill(page);
  }
  expect(await readZoom(page)).toBeGreaterThanOrEqual(target);
}

// 点のまわり 10px の内で、印や札に掛からない地図の点を探す。線は 44px の四角で拾うので、少しずれても押せる
async function findCanvasPointNear(
  page: Page,
  point: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const open = await page.evaluate(({ x, y }) => {
    for (const distance of [0, 4, 7, 10]) {
      for (let step = 0; step < 12; step++) {
        const angle = (step / 12) * Math.PI * 2;
        const px = x + Math.cos(angle) * distance;
        const py = y + Math.sin(angle) * distance;
        if (document.elementFromPoint(px, py)?.tagName === "CANVAS") return { x: px, y: py };
      }
    }
    return null;
  }, point);
  if (!open) throw new Error("印に掛からない点がありません");
  return open;
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(size, () => {
    test.use({ viewport });

    test("引いた地図で線を押すと寄り、寄った地図で塚本と尼崎の間の線を押すと尋ね、はいで行き先へ進む", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
        timeout: 30_000,
      });
      await expectStage(page, "position");
      await waitForMapStill(page);
      // 引いた地図で塚本と尼崎のあたりの線を押すと、段はそのままで、駅の印が出る倍率まで寄る
      await page.locator(".maplibregl-canvas").focus();
      const far = await panTo(page, betweenTsukamotoAmagasaki, {
        x: viewport.width / 2,
        y: viewport.height * 0.22,
      });
      expect(await readZoom(page)).toBeLessThan(12.5);
      const open = await findCanvasPointNear(page, far);
      await page.mouse.click(open.x, open.y);
      await waitForMapStill(page);
      await expectStage(page, "position");
      expect(await readZoom(page)).toBeGreaterThanOrEqual(12.5);
      await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveCount(0);
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-detail", "stations");

      // 寄った地図で塚本と尼崎の間の線を押す。押しやすいよう、さらに寄せて地図の上の方へ動かす
      await zoomOn(page, betweenTsukamotoAmagasaki, 15);
      const middle = await panTo(page, betweenTsukamotoAmagasaki, {
        x: viewport.width / 2,
        y: viewport.height * 0.22,
      });

      // 線を押すと、その駅の間か尋ねる。段は最初の段のまま
      await page.mouse.click(middle.x, middle.y);
      await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveText(
        "JR神戸線の塚本〜尼崎の間ですか",
      );
      await expectStage(page, "position");
      // 端末の位置を使っていないので、位置の扱いの説明は出さない
      await expect(page.getByText("位置は端末の中で候補を出すだけに使い、送らない。")).toHaveCount(
        0,
      );
      // はいは主のボタンの塗りにし、違うと見分けられるようにする
      const fill = (testId: string) =>
        page.getByTestId(testId).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(await fill(testIds.start.gpsConfirm)).not.toBe(await fill(testIds.start.gpsDismiss));
      await waitForMapStill(page);
      // 地図を動かした後は、問いが出てシートの高さが変わっても、見ている所を保つ
      expect(await readZoom(page)).toBeGreaterThanOrEqual(15);
      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: `${screenshotDir}between-question-${size}.png` });

      // はいで路線・方面・駅の間の段を飛ばして行き先へ進む
      await page.getByTestId(testIds.start.gpsConfirm).click();
      await expectStage(page, "destination");
      await expect(page.locator("[data-testid^='start-line-']")).toHaveCount(0);
      await expect(page.getByTestId(testIds.start.trainSegment)).toHaveCount(0);

      // 戻ると最初の段に戻る
      await page.getByTestId(testIds.start.back).click();
      await expectStage(page, "position");
    });
  });
}

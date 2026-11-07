import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { waitForFiniteAnimations } from "./replay.ts";
import { expect } from "./test.ts";

// 入口の地図の上の点を、緯度経度から求めて押すための補助

// 描いた JR神戸線の上で、塚本と尼崎の間にあり、ほかの路線の線から約700m 離れた点。lines.geojson から求めた
export const betweenTsukamotoAmagasaki: [number, number] = [135.463484, 34.718828];

export function expectStage(page: Page, stage: string) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

export async function waitForMapStill(page: Page): Promise<void> {
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-moving", "false", {
    timeout: 15_000,
  });
  await waitForFiniteAnimations(page);
}

export async function readZoom(page: Page): Promise<number> {
  return Number(await page.getByTestId(testIds.start.map).getAttribute("data-zoom"));
}

// 地図の中心と倍率から、緯度経度を画面の点に直す。地図は画面いっぱいで、回転も傾きも無い
export async function projectOnPage(page: Page, [lon, lat]: [number, number]) {
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
export async function panTo(
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
export async function zoomOn(
  page: Page,
  position: [number, number],
  target: number,
): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  for (let i = 0; i < 12 && (await readZoom(page)) < target; i++) {
    await panTo(page, position, center);
    await page.keyboard.press("Equal");
    await waitForMapStill(page);
  }
  expect(await readZoom(page)).toBeGreaterThanOrEqual(target);
}

// 点のまわり 18px の内で、印や札に掛からない地図の点を探す。線は 44px の四角で拾うので、少しずれても押せる
export async function findCanvasPointNear(
  page: Page,
  point: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const open = await page.evaluate(({ x, y }) => {
    for (const distance of [0, 4, 7, 10, 14, 18]) {
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

// 地図を指で引いて、点を画面の goal へ動かす。キーより細かく動かせるので、シートが高く地図の見える所が狭いときに使う
// 指は上部の帯とシートの間（band）の内だけで動かし、届かなければ何度かに分けて引く。指を止めてから離し、慣性で流れないようにする
export async function dragTo(
  page: Page,
  position: [number, number],
  goal: { x: number; y: number },
  band: { top: number; bottom: number },
): Promise<{ x: number; y: number }> {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const margin = 12;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  for (let i = 0; i < 12; i++) {
    const point = await projectOnPage(page, position);
    const dx = goal.x - point.x;
    const dy = goal.y - point.y;
    if (Math.hypot(dx, dy) < 4) break;
    const startX = dx > 0 ? margin : viewport.width - margin;
    const startY = dy > 0 ? band.top + margin : band.bottom - margin;
    const start = await findCanvasPointNear(page, { x: startX, y: startY });
    const endX = clamp(start.x + dx, margin, viewport.width - margin);
    const endY = clamp(start.y + dy, band.top + margin, band.bottom - margin);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 20 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    await waitForMapStill(page);
  }
  return projectOnPage(page, position);
}

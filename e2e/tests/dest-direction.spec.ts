import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { backToTrip, chooseBetweenStations } from "../support/entry.ts";
import { projectOnPage } from "../support/map-view.ts";
import { waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 行き先を選ぶ画面で、上りと下りの駅を方面ごとのまとまりに分けて見せる
// 行き先を選んだら、今いる所から行き先までの線路を乗る区間ごとに光らせ、進む向きへ光を流す

const screenshotDir = fileURLToPath(new URL("../screenshots/dest-direction/", import.meta.url));
const loopLine = "大阪|jr-west.大阪環状線|JR環状線";
const osaka: [number, number] = [135.49588, 34.70216];
const sannomiya: [number, number] = [135.19504, 34.6948];
const kyobashi: [number, number] = [135.53395, 34.69677];
const tsukamoto: [number, number] = [135.46889, 34.71273];
const amagasaki: [number, number] = [135.43178, 34.73185];

test.setTimeout(120_000);

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" }]);
});

function expectStage(page: Page, stage: string) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

async function openMap(page: Page) {
  await page.goto("/?mock=1");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
}

async function openStation(page: Page, name: string) {
  await openMap(page);
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.originSearch).fill(name);
  await page.getByTestId(testIds.start.originOption(name)).first().click();
  await expectStage(page, "destination");
}

async function capture(page: Page, name: string, still = true) {
  mkdirSync(screenshotDir, { recursive: true });
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-moving", "false");
  if (still) await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}${name}.png` });
}

// 2 点の距離（m）。関西の範囲での近似
function measureMeters(a: [number, number], b: [number, number]): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * 111_320 * Math.cos(lat), (b[1] - a[1]) * 111_320);
}

async function readPoint(page: Page, name: "data-route-start" | "data-route-end") {
  const value = await page.getByTestId(testIds.start.map).getAttribute(name);
  return (value ?? "0,0").split(",").map(Number) as [number, number];
}

// 方面のまとまりの見出しと駅。見出しは「◯◯方面」
async function readGroups(page: Page) {
  return page.locator("[data-testid^='start-group-direction-']").evaluateAll((sections) =>
    sections.map((section) => ({
      direction: section.getAttribute("data-direction") ?? "",
      stops: [...section.querySelectorAll("[data-testid^='start-destination-candidate-']")].map(
        (el) => el.textContent ?? "",
      ),
    })),
  );
}

test.describe("方面ごとのまとまり 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test("大阪で環状線を選ぶと、駅が 2 つの方面に分かれ、近い順に並ぶ", async ({ page }) => {
    await openStation(page, "大阪");
    await page.getByTestId(testIds.start.routeLine(loopLine)).click();
    await expectStage(page, "direction");
    const groups = await readGroups(page);
    expect(groups).toHaveLength(2);
    for (const group of groups) expect(group.direction).toMatch(/方面$/);
    const toward = (name: string) => groups.find((g) => g.stops.includes(name));
    expect(toward("天満")?.stops.slice(0, 3)).toEqual(["天満", "桜ノ宮", "京橋"]);
    expect(toward("福島")?.stops.slice(0, 3)).toEqual(["福島", "野田", "西九条"]);
    expect(toward("天満")).not.toBe(toward("福島"));
    // 地図の駅の札にも、方面ごとに違う向きの矢印が付く
    const heading = (name: string) =>
      page
        .getByTestId(testIds.start.mapStop(`pick-${name}`))
        .locator("[data-heading]")
        .getAttribute("data-heading");
    expect(await heading("天満")).not.toBe(await heading("福島"));
    await capture(page, "osaka-loop");

    // まとまりの駅を押すと、方面を聞かずに様子へ進む
    await page.getByTestId(testIds.start.destinationCandidate("京橋")).click();
    await backToTrip(page);
    await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("鶴橋");
  });

  test("塚本〜尼崎の間では、三ノ宮の側と大阪の側の行き先が分かれる", async ({ page }) => {
    await openMap(page);
    await chooseBetweenStations(page, "JR神戸線", "塚本", "尼崎");
    const groups = await readGroups(page);
    expect(groups).toHaveLength(2);
    const west = groups.find((g) => g.stops.includes("三ノ宮"));
    const east = groups.find((g) => g.stops.includes("大阪"));
    expect(west).toBeDefined();
    expect(east).toBeDefined();
    expect(west).not.toBe(east);
    expect(west?.stops).not.toContain("京都");
    await capture(page, "tsukamoto-amagasaki");

    // まとまりの駅を押すと、方面を聞かずに様子へ進む
    await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
    await backToTrip(page);
  });

  test("吹田で阪急千里線を選ぶと、北千里の側と天神橋筋六丁目の側に分かれる", async ({ page }) => {
    await openStation(page, "吹田");
    await page.locator("[data-testid^='start-route-line-']").filter({ hasText: "千里線" }).click();
    await expectStage(page, "direction");
    const groups = await readGroups(page);
    expect(groups).toHaveLength(2);
    const north = groups.find((g) => g.stops.includes("豊津"));
    const south = groups.find((g) => g.stops.includes("下新庄"));
    expect(north?.stops[0]).toBe("豊津");
    expect(south?.stops[0]).toBe("下新庄");
    expect(north).not.toBe(south);
    await capture(page, "suita-senri");
  });
});

test.describe("行き先までの光 1280x800", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("大阪から三ノ宮を選ぶと、光る区間の両端が大阪と三ノ宮に合い、光が流れる", async ({
    page,
  }) => {
    await openStation(page, "大阪");
    await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
    await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
    await backToTrip(page);
    const map = page.getByTestId(testIds.start.map);
    await expect(map).toHaveAttribute("data-route-legs", "1");
    expect(measureMeters(await readPoint(page, "data-route-start"), osaka)).toBeLessThan(300);
    expect(measureMeters(await readPoint(page, "data-route-end"), sannomiya)).toBeLessThan(300);
    // 0.25 秒ずらして 2 枚撮り、光の帯が三ノ宮の側へ進むことを目で確かめる
    await capture(page, "flow-1", false);
    await page.waitForTimeout(250);
    await capture(page, "flow-2", false);
  });

  test("駅の間からの光は、駅の間の中ほどから始まる", async ({ page }) => {
    await openMap(page);
    await chooseBetweenStations(page, "JR神戸線", "塚本", "尼崎");
    await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
    await backToTrip(page);
    const start = await readPoint(page, "data-route-start");
    const span = measureMeters(tsukamoto, amagasaki);
    expect(measureMeters(start, tsukamoto)).toBeLessThan(span);
    expect(measureMeters(start, amagasaki)).toBeLessThan(span);
    expect(measureMeters(start, tsukamoto)).toBeGreaterThan(span / 4);
    expect(measureMeters(await readPoint(page, "data-route-end"), sannomiya)).toBeLessThan(300);
  });

  test("環状線の方面を選び直すと、光る区間が反対の向きに切り替わる", async ({ page }) => {
    await openStation(page, "大阪");
    await page.getByTestId(testIds.start.routeLine(loopLine)).click();
    await page.getByTestId(testIds.start.destinationCandidate("京橋")).click();
    await backToTrip(page);
    const map = page.getByTestId(testIds.start.map);
    await expect(map).toHaveAttribute("data-route-meters", /\d+/);
    const short = Number(await map.getAttribute("data-route-meters"));
    expect(measureMeters(await readPoint(page, "data-route-end"), kyobashi)).toBeLessThan(300);

    // 出発の行から路線と方面を選び直す
    await page.getByTestId(testIds.start.routeSummary).click();
    await expectStage(page, "station");
    await page.getByTestId(testIds.start.line(loopLine)).click();
    await expectStage(page, "direction");
    await page
      .locator(`[data-testid^='start-direction-${loopLine}>'][data-testid$='.天王寺']`)
      .click();
    await backToTrip(page);
    await expect(map).not.toHaveAttribute("data-route-meters", String(short));
    const long = Number(await map.getAttribute("data-route-meters"));
    expect(long).toBeGreaterThan(short * 2);
    expect(measureMeters(await readPoint(page, "data-route-start"), osaka)).toBeLessThan(300);
    expect(measureMeters(await readPoint(page, "data-route-end"), kyobashi)).toBeLessThan(300);
    await capture(page, "loop-switched", false);
  });

  test("乗り換えのある行き先は、乗る区間ごとに光らせる", async ({ page }) => {
    await openStation(page, "大阪");
    await page.getByTestId(testIds.start.destinationSearch).fill("北千里");
    await page.getByTestId(testIds.start.destinationOption("北千里")).click();
    await expectStage(page, "station");
    await page.locator("[data-testid^='start-line-']").filter({ hasText: "JR京都線" }).click();
    await expectStage(page, "direction");
    await page
      .locator("[data-testid^='start-direction-']")
      .filter({ hasText: "京都" })
      .first()
      .click();
    await backToTrip(page);
    const map = page.getByTestId(testIds.start.map);
    await expect(map).toHaveAttribute("data-route-legs", /^[2-9]$/);
    await capture(page, "transfer", false);
  });

  test("動きを減らす設定では、光を流さず向きの矢印を出す", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openStation(page, "大阪");
    await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
    await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
    await backToTrip(page);
    await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-route-legs", "1");
    await capture(page, "reduced-motion");
  });
});

// スマートフォンでも、行き先を選んだ直後の段で光る経路の全体が地図の帯に入る
for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`スマートフォンの光 ${size}`, () => {
    test.use({ viewport, deviceScaleFactor: 2 });

    test("大阪から三ノ宮を選ぶと、光る経路の両端がシートの上の地図に見え、光が流れる", async ({
      page,
    }) => {
      await openStation(page, "大阪");
      await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
      await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
      await backToTrip(page);
      const map = page.getByTestId(testIds.start.map);
      await expect(map).toHaveAttribute("data-route-legs", "1");
      await expect(map).toHaveAttribute("data-moving", "false");
      const header = await page.getByTestId("app-header").boundingBox();
      const sheet = await page.getByTestId(testIds.start.sheet).boundingBox();
      if (!header || !sheet) throw new Error("上部の帯かシートがありません");
      for (const name of ["data-route-start", "data-route-end"] as const) {
        const point = await projectOnPage(page, await readPoint(page, name));
        expect(point.x, name).toBeGreaterThan(8);
        expect(point.x, name).toBeLessThan(viewport.width - 8);
        expect(point.y, name).toBeGreaterThan(header.y + header.height);
        expect(point.y, name).toBeLessThan(sheet.y);
      }
      // 行程の札の下のボタンで、判断を出し直せる
      await expect(page.getByTestId(testIds.start.judge)).toBeAttached();
      await capture(page, `phone-flow-1-${size}`, false);
      await page.waitForTimeout(250);
      await capture(page, `phone-flow-2-${size}`, false);
    });
  });
}

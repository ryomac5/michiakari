import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  dragTo,
  expectStage,
  findCanvasPointNear,
  projectOnPage,
  waitForMapStill,
} from "../support/map-view.ts";
import { expect, test } from "../support/test.ts";

// 豊津の近くで阪急千里線の線を押すと、押した所の駅の間が先頭に出て、その区間だけが光る
// 千里線の駅の並びは、淡路、下新庄、吹田、豊津、関大前

const screenshotDir = fileURLToPath(new URL("../screenshots/senri-tap/", import.meta.url));
const choiceLocator = "[data-testid^='start-gps-choice-']";

type Section = { name: string; middle: [number, number]; ends: [string, string] };
// 阪急千里線の駅の位置。同じ名前の JR吹田とは約600m 離れる
const senriStations: Record<string, [number, number]> = {
  吹田: [135.51729, 34.7596],
  豊津: [135.50896, 34.76453],
  関大前: [135.50604, 34.77095],
};
// 描いた千里線を 2 駅で切り出した線の、長さの半分の点
const sections: Section[] = [
  { name: "suita-toyotsu", middle: [135.513032, 34.761972], ends: ["吹田", "豊津"] },
  { name: "toyotsu-kandaimae", middle: [135.50863, 34.768057], ends: ["豊津", "関大前"] },
];

test.setTimeout(120_000);

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" }]);
});

async function openTop(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await expectStage(page, "position");
  await waitForMapStill(page);
}

async function openShinOsaka(page: Page) {
  await openTop(page);
  await page.getByTestId(testIds.start.hub("shin-osaka")).click();
  await expectStage(page, "area");
  await waitForMapStill(page);
}

// 押した区間の名前。1 件なら問いの文、複数なら一覧の先頭の札
async function readFirstChoice(page: Page): Promise<string> {
  const question = page.getByTestId(testIds.start.gpsQuestion);
  const choices = page.locator(choiceLocator);
  await expect(question.or(choices.first())).toBeVisible({ timeout: 10_000 });
  return (await choices.count()) > 0
    ? ((await choices.first().textContent()) ?? "")
    : ((await question.textContent()) ?? "");
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(size, () => {
    test.use({ viewport });
    for (const [stage, open] of [
      ["position", openTop],
      ["area", openShinOsaka],
    ] as const) {
      for (const section of sections) {
        test(`${stage} で千里線の ${section.ends.join("〜")} の中ほどを押すと、その駅の間が先頭に出て光る`, async ({
          page,
        }) => {
          await open(page);
          // 倍率は変えずに指で地図を引き、押す点を上部の帯とシートの間の中ほどへ動かす
          const sheetTop =
            (await page.getByTestId(testIds.start.sheet).boundingBox())?.y ?? viewport.height;
          const band = { top: 180, bottom: sheetTop };
          await dragTo(
            page,
            section.middle,
            { x: viewport.width / 2, y: (band.top + band.bottom) / 2 },
            band,
          );
          const middle = await projectOnPage(page, section.middle);
          expect(middle.y).toBeGreaterThan(band.top);
          expect(middle.y).toBeLessThan(band.bottom);
          // 中ほどが印や札に隠れていれば、18px の内で地図の線の上の点を押す
          const point = await findCanvasPointNear(page, middle);
          await page.mouse.click(point.x, point.y);
          const first = await readFirstChoice(page);
          await waitForMapStill(page);
          const map = page.getByTestId(testIds.start.map);
          await expect(map).toHaveAttribute("data-section-focus", /^between:/);
          const focus = (await map.getAttribute("data-section-focus")) ?? "";
          mkdirSync(screenshotDir, { recursive: true });
          await page.screenshot({ path: `${screenshotDir}${stage}-${section.name}-${size}.png` });
          // 先頭の候補と、いちばん強く光る区間の両端が、押した駅の間になる
          expect(first).toMatch(
            new RegExp(
              `阪急千里線の(${section.ends[0]}〜${section.ends[1]}|${section.ends[1]}〜${section.ends[0]})の間`,
            ),
          );
          const [, lineId, from, to] = focus.split(":");
          expect(lineId).toBe("hankyu.千里線");
          expect([from, to].sort()).toEqual([...section.ends].sort());
          // 光る区間の両端は、千里線の 2 駅の近く（線路へ下ろした点）にある
          const ends = ((await map.getAttribute("data-section-ends")) ?? "")
            .split(";")
            .map((p) => p.split(",").map(Number) as [number, number]);
          for (const name of section.ends) {
            const station = senriStations[name] as [number, number];
            const near = ends.some(
              ([lon, lat]) =>
                Math.hypot((lon - station[0]) * 91_000, (lat - station[1]) * 111_000) < 150,
            );
            expect(near, `${name} の近くで光る区間が終わる`).toBe(true);
          }
        });
      }
    }
  });
}

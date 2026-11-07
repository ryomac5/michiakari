import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { backToTrip } from "../support/entry.ts";
import {
  betweenTsukamotoAmagasaki,
  expectStage,
  projectOnPage,
  waitForMapStill,
  zoomOn,
} from "../support/map-view.ts";
import { expect, test } from "../support/test.ts";

// 入口の地図で、段ごとに線路の線を押したときの答えを表で確かめる
// 駅の位置をまだ答えていない段では、線を押すと駅の間の候補が出る
// 駅にいると答えて路線や方面を選ぶ段では、線を押すとその段の答え（路線、方面）になる

const screenshotDir = fileURLToPath(new URL("../screenshots/area-tap/", import.meta.url));
const choiceLocator = "[data-testid^='start-gps-choice-']";
const loopLine = "大阪|jr-west.大阪環状線|JR環状線";

// 描いた大阪環状線の、大阪と天満の間の頂点。中ほどを先に試す
const loopOsakaTemma: [number, number][] = [
  [135.50438, 34.70633],
  [135.50579, 34.7066],
  [135.50377, 34.70608],
  [135.50733, 34.70661],
  [135.50177, 34.70504],
  [135.50901, 34.70649],
];
// 描いた大阪環状線の、大阪城公園〜京橋と玉造〜森ノ宮の間の頂点。引いた地図で大阪〜天満が印に隠れるときに使う
const loopEast: [number, number][] = [
  [135.53421, 34.6861],
  [135.53386, 34.67691],
];
// 描いた JR神戸線の、塚本と尼崎の間の点
const kobeTsukamotoAmagasaki: [number, number][] = [betweenTsukamotoAmagasaki];
// 押す点から離しておく、地図に出ている駅とエリアの印
const markSelector =
  "[data-testid^='start-place-'], [data-testid^='start-map-stop-'], [data-testid^='start-hub-']";

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

// 線の上の点のうち、上部の帯とシートの間に見え、印や札に掛からず、見えている駅の印から 24px より離れた点
async function findLinePoint(page: Page, vertices: [number, number][]) {
  const sheet = page.getByTestId(testIds.start.sheet);
  const sheetBox = (await sheet.count()) > 0 ? await sheet.boundingBox() : null;
  const sheetTop = sheetBox?.y ?? page.viewportSize()?.height ?? 0;
  const marks = await page.locator(markSelector).evaluateAll((els) =>
    els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })),
  );
  for (const vertex of vertices) {
    const point = await projectOnPage(page, vertex);
    if (point.y < 72 || point.y > sheetTop - 8) continue;
    if (marks.some((m) => Math.hypot(m.x - point.x, m.y - point.y) < 24)) continue;
    const tag = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point);
    if (tag === "CANVAS") return point;
  }
  throw new Error("押せる線の点がありません");
}

// 駅にいると答えて大阪を選び、行き先の段へ進む
async function openOsakaStation(page: Page) {
  await openTop(page);
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await expectStage(page, "area");
  await waitForMapStill(page);
  await page.getByTestId(testIds.start.areaPlace("osaka")).click();
  await expectStage(page, "destination");
  await waitForMapStill(page);
}

type Outcome =
  | { kind: "between"; label: RegExp; picked: RegExp }
  | { kind: "stage"; stage: RegExp; text?: RegExp };

type StageCase = {
  name: string;
  stage: string;
  reach: (page: Page) => Promise<void>;
  vertices: [number, number][];
  outcome: Outcome;
};

const loopBetween: Outcome = {
  kind: "between",
  label: /JR環状線の(大阪〜天満|天満〜大阪)の間/,
  picked: /(大阪|天満)\s*JR環状線/,
};

const cases: StageCase[] = [
  {
    name: "最初",
    stage: "position",
    reach: openTop,
    vertices: kobeTsukamotoAmagasaki,
    outcome: {
      kind: "between",
      label: /JR神戸線の(塚本〜尼崎|尼崎〜塚本)の間/,
      picked: /(塚本|尼崎)\s*JR神戸線/,
    },
  },
  {
    name: "駅にいると答えた後の駅を選ぶ段",
    stage: "kansai",
    reach: async (page) => {
      await openTop(page);
      await page.getByTestId(testIds.start.positionStation).click();
      await expectStage(page, "kansai");
      await waitForMapStill(page);
    },
    vertices: kobeTsukamotoAmagasaki,
    outcome: {
      kind: "between",
      label: /JR神戸線の(塚本〜尼崎|尼崎〜塚本)の間/,
      picked: /(塚本|尼崎)\s*JR神戸線/,
    },
  },
  {
    name: "エリアに寄った後",
    stage: "area",
    reach: async (page) => {
      await openTop(page);
      await page.getByTestId(testIds.start.hub("umeda")).click();
      await expectStage(page, "area");
      await waitForMapStill(page);
    },
    vertices: loopOsakaTemma,
    outcome: loopBetween,
  },
  {
    name: "駅の間の段",
    stage: "between",
    reach: async (page) => {
      await openTop(page);
      await page.getByTestId(testIds.start.positionTrain).click();
      await expectStage(page, "between");
      await waitForMapStill(page);
    },
    vertices: loopOsakaTemma,
    outcome: loopBetween,
  },
  {
    // 駅にいると答えて大阪を選んだ後は、線を押すと、行き先より先にその路線を選ぶ
    name: "駅を選んだ後の行き先の段",
    stage: "destination",
    reach: openOsakaStation,
    vertices: [...loopOsakaTemma, ...loopEast],
    outcome: { kind: "stage", stage: /^direction$/, text: /JR環状線/ },
  },
  {
    // 大阪で路線を選び直す段では、線を押すとその路線を選ぶ
    name: "路線を選ぶ段",
    stage: "station",
    reach: async (page) => {
      await openOsakaStation(page);
      await page.getByTestId(testIds.start.destinationCandidate("高槻")).click();
      await backToTrip(page);
      await page.getByTestId(testIds.start.routeSummary).click();
      await expectStage(page, "station");
      await waitForMapStill(page);
      // 判断から戻った地図は引いていて、環状線の線が駅の印に隠れやすい。環状線の東側へ 1 段寄せる
      await page.locator(".maplibregl-canvas").focus();
      await zoomOn(page, loopEast[0] as [number, number], 11);
    },
    vertices: [...loopOsakaTemma, ...loopEast],
    outcome: { kind: "stage", stage: /^direction$/, text: /JR環状線/ },
  },
  {
    // 路線を選んだ後は、線を押すと、押した点に向かう方面を選ぶ。印を出した駅の近くなら、その駅を行き先にする
    name: "路線を選んだ後",
    stage: "direction",
    reach: async (page) => {
      await openOsakaStation(page);
      await page.getByTestId(testIds.start.routeLine(loopLine)).click();
      await expectStage(page, "direction");
      await waitForMapStill(page);
    },
    vertices: [...loopOsakaTemma, ...loopEast],
    outcome: { kind: "stage", stage: /^(destination|cause)$/, text: /JR環状線/ },
  },
];

async function expectBetween(page: Page, outcome: Extract<Outcome, { kind: "between" }>) {
  const question = page.getByTestId(testIds.start.gpsQuestion);
  const choice = page.locator(choiceLocator).filter({ hasText: outcome.label });
  await expect(question.or(choice)).toBeVisible({ timeout: 10_000 });
  expect(await page.locator(choiceLocator).count()).toBeLessThanOrEqual(3);
  await waitForMapStill(page);
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute(
    "data-section-focus",
    /^between:/,
  );
  return async () => {
    if ((await choice.count()) > 0) await choice.click();
    else {
      await expect(question).toHaveText(outcome.label);
      await page.getByTestId(testIds.start.gpsConfirm).click();
    }
    await expectStage(page, "destination");
    await expect(page.getByTestId(testIds.start.sheet)).toContainText(outcome.picked);
  };
}

// 押した点で行き先まで決まると、自動で判断の画面へ移る。そのときは行程の札へ戻って確かめる
async function returnIfJudged(page: Page): Promise<void> {
  const judgment = page.getByTestId(testIds.judgment.screen);
  const destination = page.locator("[data-testid='start-screen'][data-stage='destination']");
  await expect(judgment.or(destination)).toBeVisible({ timeout: 30_000 });
  if (await judgment.isVisible()) await backToTrip(page);
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(size, () => {
    test.use({ viewport });
    for (const c of cases) {
      test(`${c.name}（${c.stage}）で線を押す`, async ({ page }) => {
        await c.reach(page);
        await expectStage(page, c.stage);
        const point = await findLinePoint(page, c.vertices);
        await page.mouse.click(point.x, point.y);
        if (c.outcome.kind === "between") {
          const choose = await expectBetween(page, c.outcome);
          await expectStage(page, c.stage);
          mkdirSync(screenshotDir, { recursive: true });
          await page.screenshot({ path: `${screenshotDir}${c.stage}-${size}.png` });
          await choose();
          return;
        }
        if (c.outcome.stage.test("cause")) await returnIfJudged(page);
        await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute(
          "data-stage",
          c.outcome.stage,
        );
        if (c.outcome.text)
          await expect(page.getByTestId(testIds.start.sheet)).toContainText(c.outcome.text);
        await waitForMapStill(page);
        mkdirSync(screenshotDir, { recursive: true });
        await page.screenshot({ path: `${screenshotDir}${c.stage}-${size}.png` });
      });
    }
  });
}

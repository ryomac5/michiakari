/// <reference lib="dom" />
// page 内で動かす関数のために DOM の型を読む
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { addAnswers, type CauseAnswerInput, expectJudgmentOpened } from "../support/add-info.ts";
import { chooseBetweenStations } from "../support/entry.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 判断の画面を地図だけで読める形にしたことを確かめる
// 閉じたシートは行動の見出しと時刻の 1 行と注意書きだけにし、地図が画面の半分以上を占める
// 車内で次の駅まで動く判断では、列車の印が動き、降りる印が出て、その先の経路が光る

const screenshotRoot = fileURLToPath(new URL("../screenshots/map-first/", import.meta.url));

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(180_000);

async function capture(page: Page, theme: string, name: string, settle = true): Promise<void> {
  if (settle) await waitForFiniteAnimations(page);
  const dir = `${screenshotRoot}${theme}/`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}${name}.png` });
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
}

// 塚本から大阪へ向かう途中、塚本と大阪の間で人身事故により止まり、受信の放送を聞いた。判断が出てから足す
async function startInCarToOsaka(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await chooseBetweenStations(page, "JR神戸線", "塚本", "大阪");
  await page.getByTestId(testIds.start.destinationSearch).fill("きょうと");
  await page.getByTestId(testIds.start.destinationOption("京都")).click();
  const direction = page.locator(`[data-testid="${testIds.start.screen}"][data-stage="direction"]`);
  await expect(direction.or(page.getByTestId(testIds.judgment.screen))).toBeVisible({
    timeout: 30_000,
  });
  if (await direction.isVisible())
    await page
      .locator("[data-testid^='start-direction-']:not([data-testid$='.神戸'])")
      .first()
      .click();
  await expectJudgmentOpened(page);
  await addAnswers(page, {
    cause: "person",
    protection: "heard",
    elapsed: "m10",
    resume: "unknown",
  });
  await openSheet(page, "collapsed");
}

type StationEntry = {
  origin: string;
  destinationQuery: string;
  destination: string;
  cause: CauseAnswerInput;
  action: "wait" | "switch";
};

// 駅にいる人の入口を答えて判断を出し、原因と止まってから 10 分くらいを足す。見込みは聞いていない
async function startAtStation(page: Page, entry: StationEntry): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.originSearch).fill(entry.origin);
  await page.getByTestId(testIds.start.originOption(entry.origin)).click();
  await page.getByTestId(testIds.start.destinationSearch).fill(entry.destinationQuery);
  await page.getByTestId(testIds.start.destinationOption(entry.destination)).click();
  await expectJudgmentOpened(page);
  await addAnswers(page, { cause: entry.cause, elapsed: "m10", resume: "unknown" });
  await openSheet(page, "collapsed");
  await waitForMapReady(page);
  await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
    "data-action",
    entry.action,
  );
}

// 閉じたシートは見出しと時刻の 1 行と注意書きだけで、地図が画面の半分以上を占める
async function expectMapFirst(page: Page): Promise<void> {
  const sheet = page.getByTestId(testIds.judgment.sheet);
  await expect(sheet).toHaveAttribute("data-snap", "collapsed");
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toBeInViewport();
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toBeInViewport();
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).not.toBeInViewport();
  const viewport = page.viewportSize();
  const top = await page.getByTestId(testIds.judgment.sheetHandle).evaluate((el) => {
    return el.getBoundingClientRect().top;
  });
  const header = await page
    .locator("header")
    .first()
    .evaluate((el) => el.getBoundingClientRect().bottom);
  expect(viewport).not.toBeNull();
  // 上部の帯の下からシートの上端までが、地図の見える高さ
  expect(top - header).toBeGreaterThan((viewport?.height ?? 0) / 2);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`地図で読む判断 ${theme}`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([
        { name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" },
        { name: "theme", value: theme, url: baseURL ?? "" },
      ]);
    });

    test("塚本〜大阪の間の車内では、列車が大阪まで動き、降りる印が出て、その先が光る", async ({
      page,
    }) => {
      await startInCarToOsaka(page);
      await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute(
        "data-status",
        "ready",
        { timeout: 60_000 },
      );
      const map = page.getByTestId(testIds.judgment.map);
      await expect(map).toHaveAttribute("data-motion", /^(ride|alight|route|done)$/, {
        timeout: 30_000,
      });
      await expect(page.getByTestId(mapTestIds.motionTrain)).toBeAttached();
      await capture(page, theme, "incar-1-open", false);
      await expect(map).toHaveAttribute("data-motion", /^(alight|route|done)$/, {
        timeout: 15_000,
      });
      await capture(page, theme, "incar-2-alight", false);
      await expect(map).toHaveAttribute("data-motion", "done", { timeout: 15_000 });
      await expect(page.getByTestId(mapTestIds.alight)).toBeVisible();
      await capture(page, theme, "incar-3-route");
      await expectMapFirst(page);
      await expect(page.getByTestId(mapTestIds.here)).toContainText("塚本〜大阪の間");
      await expect(page.getByTestId(testIds.judgment.timeLine)).toHaveText(
        /^大阪に\d{1,2}時\d{2}分ごろ着く見込み$/,
      );
      // 駅の間の車内でも、動き出す見込みの幅と大阪に着く時刻の帯を地図に重ねる
      const band = page.getByTestId(testIds.judgment.resumeBand);
      await expect(band).toHaveAttribute("data-kind", "in-car");
      await expect(band).toBeInViewport();
      await expect(band).toContainText(/\d{2}:\d{2}〜\d{2}:\d{2}/);
      await expect(band).toContainText(/大阪着 \d{2}:\d{2}/);
      // もう一度再生できる
      await page.getByTestId(mapTestIds.motionReplay).click();
      await expect(map).toHaveAttribute("data-motion", /^(ride|alight|route)$/);
      await expect(map).toHaveAttribute("data-motion", "done", { timeout: 15_000 });
      // 凡例は詳細のいちばん下に置く。情報を追加する欄より後ろにある
      await openSheet(page, "full");
      const legendAfterAddInfo = await page
        .getByTestId(mapTestIds.legend)
        .evaluate(
          (legend, addInfoId) =>
            Boolean(
              document
                .querySelector(`[data-testid="${addInfoId}"]`)
                ?.compareDocumentPosition(legend) === Node.DOCUMENT_POSITION_FOLLOWING,
            ),
          testIds.judgment.addInfo,
        );
      expect(legendAfterAddInfo).toBe(true);
    });

    test("駅にいて乗り換える判断では、乗り換えの経路を光らせ、再開の見込みの帯を地図に重ねる", async ({
      page,
    }) => {
      // 大阪駅から三ノ宮へ。人身事故で止まっている
      await startAtStation(page, {
        origin: "大阪",
        destinationQuery: "さんのみや",
        destination: "三ノ宮",
        cause: "person",
        action: "switch",
      });
      await expect(page.getByTestId(testIds.judgment.timeLine)).toHaveText(
        /^三ノ宮に\d{1,2}時\d{2}分ごろ着く見込み$/,
      );
      await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute(
        "data-route-glow",
        "true",
      );
      await expect(page.getByTestId(testIds.judgment.resumeBand)).toBeInViewport();
      await capture(page, theme, "switch");
      await expectMapFirst(page);
    });

    test("駅で待つ判断では、今の路線の行き先までを光らせ、再開の見込みの帯を地図に重ねる", async ({
      page,
    }) => {
      // 京橋から天王寺へ。車内の急病人の救護で止まっている
      await startAtStation(page, {
        origin: "京橋",
        destinationQuery: "天王寺",
        destination: "天王寺",
        cause: "inCar",
        action: "wait",
      });
      await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute(
        "data-route-glow",
        "true",
      );
      await expect(page.getByTestId(testIds.judgment.resumeBand)).toBeInViewport();
      await capture(page, theme, "wait");
      await expectMapFirst(page);
    });
  });
}

test.describe("動きを減らす設定", () => {
  test.use({ reducedMotion: "reduce" });

  test("車内の判断は動かさずに最後の状態を出し、向きは矢印で示す", async ({ page }) => {
    await startInCarToOsaka(page);
    const map = page.getByTestId(testIds.judgment.map);
    await expect(map).toHaveAttribute("data-motion", "done", { timeout: 60_000 });
    await expect(map).toHaveAttribute("data-flow", "arrows");
    await expect(page.getByTestId(mapTestIds.alight)).toBeVisible();
    await expect(page.getByTestId(mapTestIds.motionReplay)).toBeHidden();
    await capture(page, "light", "incar-reduced-motion");
  });
});

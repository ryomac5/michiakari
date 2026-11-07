/// <reference lib="dom" />
// page 内で動かす関数のために DOM の型を読む
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import {
  addAnswers,
  type CauseAnswerInput,
  expectJudgmentOpened,
  openAddInfo,
} from "../support/add-info.ts";
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

type InCarEntry = {
  line: string;
  from: string;
  to: string;
  destinationQuery: string;
  destination: string;
  cause: CauseAnswerInput;
  // 方面を聞かれたときに選ぶ方面の終わりの駅
  terminal?: string;
  // 再開の見込みの時刻の候補から選ぶ位置
  resumeAt: "first" | "last";
};

// 駅と駅の間の車内から、いる所と行き先だけを答えて判断を出す
// 原因、止まってから 10 分くらい、放送で聞いた再開の見込みは、判断が出てから情報を追加するで足す
async function startInCar(page: Page, entry: InCarEntry): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await chooseBetweenStations(page, entry.line, entry.from, entry.to);
  await page.getByTestId(testIds.start.destinationSearch).fill(entry.destinationQuery);
  await page.getByTestId(testIds.start.destinationOption(entry.destination)).click();
  const direction = page.locator(`[data-testid="${testIds.start.screen}"][data-stage="direction"]`);
  await expect(direction.or(page.getByTestId(testIds.judgment.screen))).toBeVisible({
    timeout: 30_000,
  });
  if (await direction.isVisible())
    await page
      .locator(`[data-testid^='start-direction-'][data-testid$='.${entry.terminal}']`)
      .click();
  await expectJudgmentOpened(page);
  await addAnswers(page, {
    cause: entry.cause,
    elapsed: "m10",
    resume: { time: entry.resumeAt },
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

// 印が、上の帯と見込みの帯の下から、閉じたシートの上までの見える範囲に入っているか
async function expectInMapView(page: Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  const band = await page.getByTestId(testIds.judgment.resumeBand).boundingBox();
  const header = await page.locator("header").first().boundingBox();
  const sheet = await page.getByTestId(testIds.judgment.sheet).boundingBox();
  expect(box, `${testId} が地図に無い`).not.toBeNull();
  const top = Math.max(
    (header?.y ?? 0) + (header?.height ?? 0),
    (band?.y ?? 0) + (band?.height ?? 0),
  );
  const width = page.viewportSize()?.width ?? 0;
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(top);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(sheet?.y ?? 0);
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
}

// 情報を追加するから止まっている区間を地図で選び始め、選んでいる途中を撮ってからやめる
// 選んでいる間は、上端に選び方の案内だけを出し、見込みの帯と行き先の縁の札ともう一度見るボタンを隠す
async function expectSectionPickClean(page: Page, theme: string, name: string): Promise<void> {
  const addInfo = await openAddInfo(page);
  await addInfo.getByTestId(testIds.situation.item("section")).click();
  await expect(page.getByTestId(testIds.judgment.sheet)).toHaveAttribute("data-snap", "collapsed");
  const banner = page.getByTestId(mapTestIds.sectionPick);
  await expect(banner).toBeVisible();
  await expect(page.getByTestId(testIds.judgment.resumeBand)).toHaveCount(0);
  await expect(page.getByTestId(mapTestIds.destinationEdge)).toHaveCount(0);
  await expect(page.getByTestId(mapTestIds.motionReplay)).toHaveCount(0);
  // 押せる駅の印は、しぼり込みの対象外にして路線の駅を並べる
  await expect
    .poll(() => page.locator("[data-testid^='judgment-map-pick-']").count())
    .toBeGreaterThan(1);
  await page.waitForTimeout(1_000);
  await capture(page, theme, name);
  await page.getByTestId(mapTestIds.sectionPickCancel).click();
  await expect(banner).toHaveCount(0);
}

// 見出しの場所は戻るボタンとメニューだけで、行程の札も運行の状態の札も見出しに出さない
// 運行の状態は、区間を描いていなければ地図の見込みの帯の左上に小さく出す
async function expectHeaderBare(page: Page, statusText: string | RegExp): Promise<void> {
  const header = page.getByTestId(testIds.app.header);
  await expect(page.getByTestId(testIds.judgment.tripSummary)).toHaveCount(0);
  await expect(header.getByTestId(testIds.judgment.statusChip)).toHaveCount(0);
  await expect(header.getByTestId(testIds.judgment.backButton)).toBeVisible();
  const status = page
    .getByTestId(testIds.judgment.resumeBand)
    .getByTestId(testIds.judgment.statusChip);
  await expect(status).toBeVisible();
  await expect(status).toContainText(statusText);
}

// 地図に出す駅の吹き出しの数。勧める経路で乗る駅だけにしぼったので、多くても 1 つ
async function countStationBubbles(page: Page): Promise<number> {
  return page.locator("[data-testid^='judgment-map-station-']").count();
}

// 閉じたシートは見出しと時刻の 1 行と注意書きだけで、地図が画面の半分以上を占める
async function expectMapFirst(page: Page): Promise<void> {
  const sheet = page.getByTestId(testIds.judgment.sheet);
  await expect(sheet).toHaveAttribute("data-snap", "collapsed");
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toBeInViewport();
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toBeInViewport();
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).not.toBeInViewport();
  // 閉じたシートの下に、次の行の頭を覗かせない
  const bodyId = await page.getByTestId(testIds.judgment.sheetHandle).getAttribute("aria-controls");
  await expect(page.locator(`[id="${bodyId}"]`)).toHaveCSS("opacity", "0");
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

    test("大阪〜塚本の間の車内で次の駅で降りる判断では、列車が塚本まで動き、降りる印が出て、乗り換えの経路が光る", async ({
      page,
    }) => {
      // 大阪から西宮北口へ。塚本に着いてから乗り換えるほうが早い
      await startInCar(page, {
        line: "JR神戸線",
        from: "大阪",
        to: "塚本",
        destinationQuery: "西宮北口",
        destination: "西宮北口",
        cause: "person",
        terminal: "神戸",
        resumeAt: "last",
      });
      await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute(
        "data-status",
        "ready",
        { timeout: 60_000 },
      );
      const map = page.getByTestId(testIds.judgment.map);
      await expect(map).toHaveAttribute("data-in-car-plan", "alight");
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
      await expect(page.getByTestId(mapTestIds.alight)).toContainText("塚本");
      await expect(map).toHaveAttribute("data-route-glow", "true");
      await capture(page, theme, "incar-3-route");
      await expectMapFirst(page);
      await expect(page.getByTestId(mapTestIds.here)).toContainText("大阪〜塚本の間");
      await expect(page.getByTestId(testIds.judgment.timeLine)).toHaveText(
        /^塚本に\d{1,2}時\d{2}分ごろ着く見込み$/,
      );
      // 動き出す見込みの幅と塚本に着く時刻の帯を地図に重ねる
      const band = page.getByTestId(testIds.judgment.resumeBand);
      await expect(band).toHaveAttribute("data-kind", "in-car");
      await expect(band).toBeInViewport();
      // 幅の両端が同じ時刻なら、1 つの時刻だけを出す
      await expect(band).toContainText(/動き出す見込み\d{2}:\d{2}(〜\d{2}:\d{2})?/);
      await expect(band).toContainText(/塚本着 \d{2}:\d{2}/);
      // 今いる位置と降りる駅を収める。乗り換え候補の駅は出さず、塗るのは乗っている路線と乗り換え先だけ
      await expectInMapView(page, mapTestIds.here);
      await expectInMapView(page, mapTestIds.alight);
      expect(await countStationBubbles(page)).toBe(0);
      expect(Number(await map.getAttribute("data-colored-lines"))).toBeLessThanOrEqual(2);
      await expect(map).toHaveAttribute("data-walk-reach", "false");
      await expectSectionPickClean(page, theme, "incar-section-pick");
      await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
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

    test("桜ノ宮〜天満の間の車内で乗り続ける判断では、天満に降りる印を出さず、西九条まで列車が進んで光る", async ({
      page,
    }) => {
      // 車内の非常ボタンで止まり、10 分ほどで動く見込み。西九条まで乗り続ける
      await startInCar(page, {
        line: "JR環状線",
        from: "桜ノ宮",
        to: "天満",
        destinationQuery: "にしくじょう",
        destination: "西九条",
        cause: "inCar",
        resumeAt: "first",
      });
      await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute(
        "data-status",
        "ready",
        { timeout: 60_000 },
      );
      const map = page.getByTestId(testIds.judgment.map);
      await expect(map).toHaveAttribute("data-in-car-plan", "stay");
      await expect(map).toHaveAttribute("data-motion", /^(ride|alight|route|done)$/, {
        timeout: 30_000,
      });
      await capture(page, theme, "stay-1-open", false);
      await expect(map).toHaveAttribute("data-motion", "done", { timeout: 15_000 });
      await capture(page, theme, "stay-2-done");
      // その列車だけが止まる種類なので、見合わせと言わず停車中と出す
      await expectHeaderBare(page, "桜ノ宮〜天満で停車中");
      // 天満は次の駅だが、降りる駅の札を出さない
      await expect(page.getByTestId(mapTestIds.alight)).toHaveCount(0);
      // 列車は次の駅で止まらず、行き先の西九条まで線路に沿って進み、その道筋が光る
      await expect(map).toHaveAttribute("data-route-glow", "true");
      expect(Number(await map.getAttribute("data-motion-end-meters"))).toBeLessThan(600);
      // 最初に見える所には次の駅の名前を出さない。時刻の 1 行は動く時刻にする
      await expect(page.getByTestId(testIds.judgment.timeLine)).toHaveText(
        /^\d{1,2}時\d{2}分ごろ動く見込み$/,
      );
      const band = page.getByTestId(testIds.judgment.resumeBand);
      await expect(band).toBeInViewport();
      // 帯の左上の停車中の札は駅の間の位置を言うが、天満に着く時刻は出さない
      await expect(band).not.toContainText("天満着");
      await expectMapFirst(page);
      expect(await countStationBubbles(page)).toBe(0);
      // 次の駅の名前は詳細に残す
      await openSheet(page, "half");
      await expect(page.getByTestId(testIds.judgment.trainPositionChip("next"))).toContainText(
        "次は天満",
      );
      await openSheet(page, "collapsed");
      // 全体を見ると、行き先まで光る道筋を収める
      await page.getByTestId(mapTestIds.viewToggle).click();
      await expect(map).toHaveAttribute("data-view", "overview");
      await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
      await capture(page, theme, "stay-3-overview");
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
      await expectHeaderBare(page, "見合わせ");
      await expectMapFirst(page);
      // 前は乗り換え候補の 4 駅に吹き出しと徒歩の分を出していた。今は勧める経路で乗る駅だけにする
      const map = page.getByTestId(testIds.judgment.map);
      expect(await countStationBubbles(page)).toBe(1);
      await expect(map).toHaveAttribute("data-station-marks", "1");
      await expect(
        page.locator("[data-recommended='true'][data-testid^='judgment-map-station-']"),
      ).toHaveCount(1);
      // 歩いて乗りに行く経路なので、徒歩の範囲の円を出す
      await expect(map).toHaveAttribute("data-walk-reach", "true");
      // 三ノ宮は遠いので、今いる位置と乗る駅を収め、行き先は縁の札で示す
      await expect(map).toHaveAttribute("data-fit-scope", "near");
      await expect(page.getByTestId(mapTestIds.destinationEdge)).toBeVisible();
      await expectInMapView(page, mapTestIds.here);
      await expectSectionPickClean(page, theme, "switch-section-pick");
    });

    test("区間を入れた後は、運行の状態を赤い線のそばの見合わせの札で示し、帯の左上には出さない", async ({
      page,
    }) => {
      await startAtStation(page, {
        origin: "大阪",
        destinationQuery: "さんのみや",
        destination: "三ノ宮",
        cause: "person",
        action: "switch",
      });
      const addInfo = await openAddInfo(page);
      await addInfo.getByTestId(testIds.situation.item("section")).click();
      const banner = page.getByTestId(mapTestIds.sectionPick);
      await expect(banner).toBeVisible();
      // 選んでいる間は、運行の状態の札も見込みの帯と同じく隠す
      await expect(page.getByTestId(testIds.judgment.statusChip)).toHaveCount(0);
      await page.getByTestId(mapTestIds.sectionPickStation("大阪")).click();
      await page.getByTestId(mapTestIds.sectionPickStation("尼崎")).click();
      await expect(banner).toHaveCount(0);
      await waitForMapReady(page);
      const map = page.getByTestId(testIds.judgment.map);
      await expect(map).toHaveAttribute("data-blocked", "true");
      await expect(page.getByTestId(testIds.judgment.tripSummary)).toHaveCount(0);
      // 状態は 1 か所だけに出す。線のそばに見合わせの札を置ければそれで示し、置けなければ帯の左上に出す
      const tag = page.getByTestId(mapTestIds.blockedTag);
      const chip = page.getByTestId(testIds.judgment.statusChip);
      await expect
        .poll(async () => (await tag.count()) + (await chip.count()), { timeout: 15_000 })
        .toBe(1);
      await page.waitForTimeout(1_000);
      await capture(page, theme, "section-entered");
      // 全体を見ると、赤い線の中ほどに見合わせの札を付け、帯の左上の札は消す
      await page.getByTestId(mapTestIds.viewToggle).click();
      await expect(map).toHaveAttribute("data-view", "overview");
      await expect(tag).toHaveText("見合わせ 大阪〜尼崎", { timeout: 15_000 });
      await expect(chip).toHaveCount(0);
      await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
      await page.waitForTimeout(1_000);
      await capture(page, theme, "section-entered-overview");
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
      // 乗り続ける判断では駅の候補を出さず、歩かないので徒歩の範囲の円も出さない
      const map = page.getByTestId(testIds.judgment.map);
      expect(await countStationBubbles(page)).toBe(0);
      await expect(map).toHaveAttribute("data-walk-reach", "false");
      // 天王寺は近いので、今いる位置と行き先がぎりぎり入る倍率に寄せる
      await expect(map).toHaveAttribute("data-fit-scope", "destination");
      await expect(page.getByTestId(mapTestIds.destinationEdge)).toHaveCount(0);
      await expectInMapView(page, mapTestIds.here);
      await expectInMapView(page, mapTestIds.destination);
    });
  });
}

test.describe("動きを減らす設定", () => {
  test.use({ reducedMotion: "reduce" });

  test("車内の判断は動かさずに最後の状態を出し、向きは矢印で示す", async ({ page }) => {
    await startInCar(page, {
      line: "JR神戸線",
      from: "大阪",
      to: "塚本",
      destinationQuery: "西宮北口",
      destination: "西宮北口",
      cause: "person",
      terminal: "神戸",
      resumeAt: "last",
    });
    const map = page.getByTestId(testIds.judgment.map);
    await expect(map).toHaveAttribute("data-motion", "done", { timeout: 60_000 });
    await expect(map).toHaveAttribute("data-flow", "arrows");
    await expect(page.getByTestId(mapTestIds.alight)).toBeVisible();
    await expect(page.getByTestId(mapTestIds.motionReplay)).toBeHidden();
    await capture(page, "light", "incar-reduced-motion");
  });
});

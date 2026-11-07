import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { expectJudgmentOpened } from "../support/add-info.ts";
import { backToTrip, chooseTrainDirection } from "../support/entry.ts";
import { waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 入口の地図で、路線・方面・行き先・駅の間を押して選ぶ
// 地図で選んだものは下の一覧にも出し、一覧で選んだものは地図にも出す。戻る操作は 1 段ずつ引く

const screenshotDir = fileURLToPath(new URL("../screenshots/map-pick/", import.meta.url));
const loopLine = "大阪|jr-west.大阪環状線|JR環状線";
const kobeLine = "大阪|jr-west.東海道線|JR神戸線";
const kyotoLine = "大阪|jr-west.東海道線|JR京都線";
// 地図の札の面。押せる丸ではなく、表示している札を測る
const labelSelector =
  '[data-testid^="start-place-"] > [data-station-label], [data-testid^="start-map-stop-"] > span[aria-hidden]';

test.setTimeout(120_000);

function expectStage(page: Page, stage: string) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

// mock は判断の途中経過を固定の架空データで返す。判断の画面が入口の路線を使うかを見るときは外す
async function openOsaka(page: Page, mock = true): Promise<void> {
  await page.goto(mock ? "/?mock=1" : "/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await expectStage(page, "area");
  await page.getByTestId(testIds.start.place("osaka")).click();
  await expectStage(page, "destination");
}

// 地図が止まってから押す。寄せの途中で押すと、札が動いて別の物を押してしまう
async function waitForMapStill(page: Page): Promise<void> {
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-moving", "false");
  await waitForFiniteAnimations(page);
}

// 見えている札が互いに重ならないことを確かめる
async function expectLabelsApart(labels: Locator): Promise<void> {
  await expect
    .poll(() =>
      labels.evaluateAll((elements) => {
        const boxes = elements
          .filter((el) => el.checkVisibility())
          .map((el) => ({ name: el.textContent, rect: el.getBoundingClientRect() }));
        return boxes.flatMap((a, i) =>
          boxes.slice(i + 1).flatMap((b) => {
            const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
            const height =
              Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
            return width > 0 && height > 0 ? [`${a.name} / ${b.name}`] : [];
          }),
        );
      }),
    )
    .toEqual([]);
}

async function capture(page: Page, name: string, size: string): Promise<void> {
  mkdirSync(screenshotDir, { recursive: true });
  await waitForMapStill(page);
  await page.screenshot({ path: `${screenshotDir}${name}-${size}.png` });
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(size, () => {
    test.use({ viewport });

    test("大阪駅で環状線、方面、福島を地図で押して選び、判断まで進む", async ({ page }) => {
      await openOsaka(page);
      // 駅の路線の札が地図に出て、下の一覧にも同じ路線が並ぶ
      await capture(page, "osaka-lines", size);
      for (const key of [loopLine, kobeLine, kyotoLine]) {
        await expect(page.getByTestId(testIds.start.mapStop(`line-${key}`))).toBeVisible();
        await expect(page.getByTestId(testIds.start.routeLine(key))).toBeVisible();
      }
      await expectLabelsApart(page.locator(labelSelector));

      // 環状線を地図で押すと、方面を聞く。一覧にも環状線が出る
      await page.getByTestId(testIds.start.mapStop(`line-${loopLine}`)).click();
      await expectStage(page, "direction");
      await expect(page.locator("[data-testid^='start-map-stop-line-']")).toHaveCount(0);
      await expect(page.getByTestId(testIds.start.sheet)).toContainText("JR環状線");
      const mapDirections = page.locator("[data-testid^='start-map-stop-direction-']");
      await expect(mapDirections).toHaveCount(2);
      await expect(page.locator("[data-testid^='start-direction-']")).toHaveCount(2);
      await capture(page, "loop-line", size);

      // 福島の側の方面を地図で押すと、方面の先の駅が名前付きで出る
      await waitForMapStill(page);
      await mapDirections.filter({ hasText: "天王寺" }).click();
      await expectStage(page, "destination");
      const fukushima = page.getByTestId(testIds.start.mapStop("destination-福島"));
      await expect(fukushima).toBeVisible();
      // 一覧にも同じ方面と福島が出る
      await expect(page.getByTestId(testIds.start.sheet)).toContainText("天王寺");
      await expect(page.getByTestId(testIds.start.destinationCandidate("福島"))).toBeVisible();
      await expect(page.getByTestId(testIds.start.destinationUndecided)).toHaveCount(0);
      await expectLabelsApart(page.locator(labelSelector));
      await capture(page, "loop-direction", size);

      // 福島を地図で押すと行き先が福島になり、選んだ路線と方面のまま判断へ進む
      await waitForMapStill(page);
      await fukushima.click();
      await backToTrip(page);
      await expect(page.getByTestId(testIds.start.trip)).toContainText("福島");
      await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("JR環状線");
      await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("天王寺");

      // 行程の札の下のボタンで判断を出し直すと、判断も環状線で出る
      await page.getByTestId(testIds.start.judge).click();
      await expectJudgmentOpened(page);
      await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible();
      await expect(page.getByTestId(testIds.judgment.statusChip)).toContainText("環状線");
    });
  });
}

// 印の丸の外で、印にも札にも掛からず、ほかの駅の印よりこの印に近い点を探す
async function findOpenPointNear(page: Page, testId: string): Promise<{ x: number; y: number }> {
  const open = await page.evaluate((testId) => {
    const centerOf = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    const target = document.querySelector(`[data-testid="${testId}"]`);
    if (!target) return null;
    const center = centerOf(target);
    const others = [
      ...document.querySelectorAll(
        "[data-testid^='start-map-stop-pick-'], [data-testid^='start-place-']",
      ),
    ]
      .filter((el) => el !== target)
      .map(centerOf);
    for (const distance of [14, 18, 22, 26, 30]) {
      for (let step = 0; step < 24; step++) {
        const angle = (step / 24) * Math.PI * 2;
        const x = center.x + Math.cos(angle) * distance;
        const y = center.y + Math.sin(angle) * distance;
        const nearest = others.every((o) => Math.hypot(o.x - x, o.y - y) > distance + 4);
        if (nearest && document.elementFromPoint(x, y)?.tagName === "CANVAS") return { x, y };
      }
    }
    return null;
  }, testId);
  if (!open) throw new Error("印のまわりに空いた所がありません");
  return open;
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`路線の駅を押して選ぶ ${size}`, () => {
    test.use({ viewport });

    test("大阪で環状線を選ぶと両方向の駅が出て、天満の印を押すと行き先が天満になる", async ({
      page,
    }) => {
      await openOsaka(page);
      await page.getByTestId(testIds.start.routeLine(loopLine)).click();
      await expectStage(page, "direction");
      // 両方向の駅に印が出る。名前が収まらない駅も印は残す
      for (const name of ["天満", "桜ノ宮", "京橋", "福島", "野田", "西九条"]) {
        await expect(page.getByTestId(testIds.start.mapStop(`pick-${name}`))).toBeAttached();
        await expect(page.getByTestId(testIds.start.destinationCandidate(name))).toBeVisible();
      }
      // 方面の札も残す
      await expect(page.locator("[data-testid^='start-map-stop-direction-']")).toHaveCount(2);
      await capture(page, "loop-stops", size);
      await expectLabelsApart(page.locator(labelSelector));

      await waitForMapStill(page);
      // 印の丸の中心を押す
      const temma = await page.getByTestId(testIds.start.mapStop("pick-天満")).boundingBox();
      if (!temma) throw new Error("天満の印がありません");
      await page.mouse.click(temma.x + temma.width / 2, temma.y + temma.height / 2);
      await backToTrip(page);
      await expect(page.getByTestId(testIds.start.trip)).toContainText("天満");
      await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("JR環状線");
      await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("鶴橋");
      // 行程の札から戻ると方面の段に戻る
      await page.getByTestId(testIds.start.back).click();
      await expectStage(page, "direction");
    });

    test("大阪で環状線を選び、地図で天満のあたりを押すと、行き先が天満になり判断まで進む", async ({
      page,
    }) => {
      await openOsaka(page);
      await page.getByTestId(testIds.start.routeLine(loopLine)).click();
      await expectStage(page, "direction");
      await waitForMapStill(page);
      // 天満の印の丸の外で、何も無い所を押す
      const point = await findOpenPointNear(page, testIds.start.mapStop("pick-天満"));
      await page.mouse.click(point.x, point.y);
      await backToTrip(page);
      await expect(page.getByTestId(testIds.start.trip)).toContainText("天満");
      await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("JR環状線");
      await capture(page, "temma-tap", size);

      await page.getByTestId(testIds.start.judge).click();
      await expectJudgmentOpened(page);
      await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible();
      await expect(page.getByTestId(testIds.judgment.statusChip)).toContainText("環状線");
    });
  });
}

test.describe("地図と一覧の同期", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("一覧で路線を選ぶと地図に方面の札が出て、戻るで地図の段を 1 段ずつ引く", async ({
    page,
  }) => {
    await openOsaka(page);
    // 一覧で環状線を選ぶと、地図には環状線の方面の札が出る
    await page.getByTestId(testIds.start.routeLine(loopLine)).click();
    await expectStage(page, "direction");
    await expect(page.locator("[data-testid^='start-map-stop-direction-']")).toHaveCount(2);
    // 一覧で方面を選ぶと、地図には方面の先の駅が出る
    await page
      .locator(`[data-testid^='start-direction-${loopLine}>'][data-testid$='.天王寺']`)
      .click();
    await expectStage(page, "destination");
    await expect(page.getByTestId(testIds.start.mapStop("destination-福島"))).toBeVisible();
    // 一覧で福島を選ぶと判断へ進む。戻ると、地図には行き先のピンが出る
    await page.getByTestId(testIds.start.destinationCandidate("福島")).click();
    await backToTrip(page);
    await expect(page.getByTestId(testIds.start.destinationPin)).toBeVisible();

    // 戻るは行き先、方面、路線の順に 1 段ずつ引く
    await page.getByTestId(testIds.start.back).click();
    await expectStage(page, "destination");
    await expect(page.getByTestId(testIds.start.mapStop("destination-福島"))).toBeVisible();
    await page.getByTestId(testIds.start.back).click();
    await expectStage(page, "direction");
    await expect(page.locator("[data-testid^='start-map-stop-direction-']")).toHaveCount(2);
    await page.getByTestId(testIds.start.back).click();
    await expectStage(page, "destination");
    await expect(page.getByTestId(testIds.start.mapStop(`line-${loopLine}`))).toBeVisible();
    // 端末の戻る操作も同じ段を引く
    await page.getByTestId(testIds.start.routeLine(kobeLine)).click();
    await expectStage(page, "direction");
    await page.goBack();
    await expectStage(page, "destination");
  });

  test("別の路線の行き先を選んでから戻り、先に選んだ路線の駅を選ぶと、判断もその路線で出る", async ({
    page,
  }) => {
    await openOsaka(page, false);
    await page.getByTestId(testIds.start.routeLine(loopLine)).click();
    await page
      .locator(`[data-testid^='start-direction-${loopLine}>'][data-testid$='.天王寺']`)
      .click();
    await expectStage(page, "destination");
    // 環状線の方面の外の三ノ宮を検索で選ぶと、神戸線と推定する
    await page.getByTestId(testIds.start.destinationSearch).fill("三ノ宮");
    await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
    await backToTrip(page);
    await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("JR神戸線");
    // 戻って環状線の福島を選ぶと、画面も判断も環状線になる
    await page.getByTestId(testIds.start.back).click();
    await expectStage(page, "destination");
    await page.getByTestId(testIds.start.destinationCandidate("福島")).click();
    await backToTrip(page);
    await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("JR環状線");
    await page.getByTestId(testIds.start.judge).click();
    await expectJudgmentOpened(page);
    await expect(page.getByTestId(testIds.judgment.statusChip)).toContainText("環状線", {
      timeout: 30_000,
    });
    await expect(page.getByTestId(testIds.judgment.statusChip)).not.toContainText("神戸線");
    // 判断の地図は、入口で選んだ環状線の方面を区間として描かない。発表に区間が無いので、発表で確かめると添える
    const map = page.getByTestId(testIds.judgment.map);
    await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    await expect(map).toHaveAttribute("data-blocked", "false");
    await expect(page.getByTestId(mapTestIds.sectionNote)).toContainText("区間は発表で確かめる");
  });

  test("車内の駅の間は、一覧の選択が地図の点線に出て、地図の線の丸を押して選べる", async ({
    page,
  }) => {
    await page.goto("/?mock=1");
    await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
      timeout: 30_000,
    });
    await chooseTrainDirection(page, "御堂筋線", "江坂");
    const selected = page.locator("[data-testid^='start-map-segment-'][data-selected='true']");
    await expect(selected).toHaveCount(1);
    // 一覧で駅の間を変えると、地図の選んでいる駅の間も変わる
    const select = page.getByTestId(testIds.start.trainSegment);
    const before = await selected.getAttribute("data-testid");
    const current = Number(await select.inputValue());
    await select.selectOption(String(current + 1));
    await expect(selected).toHaveCount(1);
    await expect(selected).not.toHaveAttribute("data-testid", before ?? "");
    // 地図の丸を押すと、その駅の間にいるとして行き先へ進む
    await waitForMapStill(page);
    const segments = page.locator("[data-testid^='start-map-segment-']");
    await expect.poll(() => segments.count()).toBeGreaterThan(1);
    // 引いた地図で丸の押せる範囲が取れないときは、丸を押すとまずそこへ寄せる
    if ((await selected.getAttribute("data-mode")) === "approach") {
      const far = await selected.locator("[data-segment-dot]").boundingBox();
      if (!far) throw new Error("駅の間の印がありません");
      await page.mouse.click(far.x + far.width / 2, far.y + far.height / 2);
      await waitForMapStill(page);
      await expectStage(page, "trainPosition");
    }
    await expect(selected).toHaveAttribute("data-mode", "pick");
    const dot = await selected.locator("[data-segment-dot]").boundingBox();
    if (!dot) throw new Error("駅の間の印がありません");
    await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await expectStage(page, "destination");
  });
});

test.describe("引いた地図の駅の間", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test("引いた地図で駅の間の丸を押すと、隣の駅は選ばれず、そこへ寄ってから選べる", async ({
    page,
  }) => {
    await page.goto("/?mock=1");
    await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
      timeout: 30_000,
    });
    await chooseTrainDirection(page, "JR環状線", "寺田町");
    await waitForMapStill(page);
    const map = page.getByTestId(testIds.start.map);
    const selected = page.locator("[data-testid^='start-map-segment-'][data-selected='true']");
    await expect(selected).toHaveCount(1);
    // 引いた地図では丸が駅の印に重なり、選ぶ押せる丸は取れない。丸は押して寄せる
    await expect(selected).toHaveAttribute("data-mode", "approach");
    const before = Number(await map.getAttribute("data-zoom"));
    const dot = await selected.locator("[data-segment-dot]").boundingBox();
    if (!dot) throw new Error("駅の間の印がありません");
    await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await waitForMapStill(page);
    // 隣の駅は選ばれず、駅の間の段のまま寄る
    await expectStage(page, "trainPosition");
    expect(Number(await map.getAttribute("data-zoom"))).toBeGreaterThan(before);
    await expect(selected).toHaveAttribute("data-mode", "pick");
    mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: `${screenshotDir}segment-track-390x844.png` });
    // 寄った地図では、丸を押すとその駅の間にいるとして行き先へ進む
    const near = await selected.locator("[data-segment-dot]").boundingBox();
    if (!near) throw new Error("駅の間の印がありません");
    await page.mouse.click(near.x + near.width / 2, near.y + near.height / 2);
    await expectStage(page, "destination");
  });
});

import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { chooseTrainDirection } from "../support/entry.ts";
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

      // 福島を地図で押すと行き先が福島になり、選んだ路線と方面のまま様子へ進む
      await waitForMapStill(page);
      await fukushima.click();
      await expectStage(page, "cause");
      await expect(page.getByTestId(testIds.start.trip)).toContainText("福島");
      await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("JR環状線");
      await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("天王寺");

      await page.getByTestId(testIds.start.cause("unknown")).click();
      await page.getByTestId(testIds.start.elapsed("unknown")).click();
      await page.getByTestId(testIds.start.resume("unknown")).click();
      await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
      await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({
        timeout: 30_000,
      });
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
    // 一覧で福島を選ぶと、地図には行き先のピンが出る
    await page.getByTestId(testIds.start.destinationCandidate("福島")).click();
    await expectStage(page, "cause");
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
    await expectStage(page, "cause");
    await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("JR神戸線");
    // 戻って環状線の福島を選ぶと、画面も判断も環状線になる
    await page.getByTestId(testIds.start.back).click();
    await expectStage(page, "destination");
    await page.getByTestId(testIds.start.destinationCandidate("福島")).click();
    await expectStage(page, "cause");
    await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("JR環状線");
    await page.getByTestId(testIds.start.cause("unknown")).click();
    await page.getByTestId(testIds.start.elapsed("unknown")).click();
    await page.getByTestId(testIds.start.resume("unknown")).click();
    await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
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
    // 押すのは線の上。丸の押せる範囲が取れないときも、線を押せば選べる
    const dot = await selected.locator("[data-segment-dot]").boundingBox();
    if (!dot) throw new Error("駅の間の印がありません");
    await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await expectStage(page, "destination");
  });
});

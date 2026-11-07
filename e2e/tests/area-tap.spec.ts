import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { expectStage, projectOnPage, waitForMapStill } from "../support/map-view.ts";
import { expect, test } from "../support/test.ts";

// 最初の画面で大阪の丸を押して寄せ、寄った地図で大阪〜天満の間の環状線を押すと、その駅の間を選べる
// ふつうの利用者は、まずエリアを押して寄せてから線を押す

const screenshotDir = fileURLToPath(new URL("../screenshots/area-tap/", import.meta.url));
const choiceLocator = "[data-testid^='start-gps-choice-']";
// 描いた大阪環状線の、大阪と天満の間の頂点。lines.geojson から取った。中ほどを先に試す
const loopOsakaTemma: [number, number][] = [
  [135.50438, 34.70633],
  [135.50579, 34.7066],
  [135.50377, 34.70608],
  [135.50733, 34.70661],
  [135.50177, 34.70504],
];
const stationPositions: [number, number][] = [
  [135.49588, 34.70216],
  [135.51237, 34.70494],
];
const loopLabel = /JR環状線の(大阪〜天満|天満〜大阪)の間/;

test.setTimeout(120_000);

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" }]);
});

// 線の上の点のうち、上部の帯とシートの間に見え、印や札に掛からず、駅の印から 24px より離れた点
async function findLinePoint(page: Page, vertices: [number, number][]) {
  const sheet = await page.getByTestId(testIds.start.sheet).boundingBox();
  const sheetTop = sheet?.y ?? page.viewportSize()?.height ?? 0;
  const stations = await Promise.all(stationPositions.map((p) => projectOnPage(page, p)));
  for (const vertex of vertices) {
    const point = await projectOnPage(page, vertex);
    if (point.y < 72 || point.y > sheetTop - 8) continue;
    if (stations.some((s) => Math.hypot(s.x - point.x, s.y - point.y) < 24)) continue;
    const tag = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point);
    if (tag === "CANVAS") return point;
  }
  throw new Error("押せる線の点がありません");
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(size, () => {
    test.use({ viewport });

    test("大阪の丸を押して寄せた後、大阪〜天満の間の環状線を押すと、その駅の間を選べる", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
        timeout: 30_000,
      });
      await expectStage(page, "position");
      await waitForMapStill(page);
      await page.getByTestId(testIds.start.hub("umeda")).click();
      await expectStage(page, "area");
      await waitForMapStill(page);

      const point = await findLinePoint(page, loopOsakaTemma);
      await page.mouse.click(point.x, point.y);
      const question = page.getByTestId(testIds.start.gpsQuestion);
      const choice = page.locator(choiceLocator).filter({ hasText: loopLabel });
      await expect(question.or(choice)).toBeVisible({ timeout: 10_000 });
      expect(await page.locator(choiceLocator).count()).toBeLessThanOrEqual(3);
      await waitForMapStill(page);
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute(
        "data-section-focus",
        /^between:/,
      );
      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: `${screenshotDir}osaka-temma-${size}.png` });

      // 選ぶと、駅の間の車内にいるとして行き先の段へ進む
      if ((await choice.count()) > 0) await choice.click();
      else {
        await expect(question).toHaveText(loopLabel);
        await page.getByTestId(testIds.start.gpsConfirm).click();
      }
      await expectStage(page, "destination");
      await expect(page.getByTestId(testIds.start.sheet)).toContainText(/(大阪|天満)\s*JR環状線/);
    });
  });
}

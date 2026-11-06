import { fileURLToPath } from "node:url";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 最初の画面に価値の 3 行とデモの入口を出し、3 行は閉じたら次から出さない

const screenshotDir = fileURLToPath(new URL("../screenshots/start-intro/", import.meta.url));
const sizes = [
  { name: "390", width: 390, height: 844 },
  { name: "375", width: 375, height: 667 },
];

for (const size of sizes) {
  test.describe(`${size.name}px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("最初の画面に 3 行とデモの入口が出て、地図が半分以上見える", async ({ page }) => {
      await page.goto("/?mock=1");
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
        timeout: 30_000,
      });
      await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute(
        "data-stage",
        "position",
      );
      await waitForFiniteAnimations(page);
      for (const id of [
        testIds.start.introAudience,
        testIds.start.introProblem,
        testIds.start.introSolution,
        testIds.start.replayLink,
      ]) {
        await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
      }
      const sheet = await page.getByTestId(testIds.start.sheet).boundingBox();
      // シートの上端より上の、画面の半分以上が地図になる
      expect((sheet?.y ?? 0) / size.height).toBeGreaterThanOrEqual(0.5);
      await page.screenshot({ path: `${screenshotDir}start-${size.name}.png` });
    });

    test("デモを見るでリプレイの一覧へ行く", async ({ page }) => {
      await page.goto("/?mock=1");
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
        timeout: 30_000,
      });
      await page.getByTestId(testIds.start.replayLink).click();
      await expect(page).toHaveURL(/\/replay/);
    });

    test("3 行を閉じると、読み直しても次から出ない", async ({ page }) => {
      await page.goto("/?mock=1");
      await expect(page.getByTestId(testIds.start.intro)).toBeVisible();
      await page.getByTestId(testIds.start.introClose).click();
      await expect(page.getByTestId(testIds.start.intro)).toHaveCount(0);
      await expect(page.getByTestId(testIds.start.replayLink)).toBeVisible();
      await page.reload();
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
        timeout: 30_000,
      });
      await expect(page.getByTestId(testIds.start.intro)).toHaveCount(0);
      await page.getByTestId(testIds.start.positionStation).click();
      await expect(page.getByTestId(testIds.start.prompt)).toBeVisible();
      await expect(page.getByTestId(testIds.start.intro)).toHaveCount(0);
    });
  });
}

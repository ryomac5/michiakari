import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  betweenTsukamotoAmagasaki,
  expectStage,
  findCanvasPointNear,
  panTo,
  readZoom,
  waitForMapStill,
  zoomOn,
} from "../support/map-view.ts";
import { expect, test } from "../support/test.ts";

// 最初の地図で駅と駅の間の線を押すと、その駅の間の車内にいるか確かめ、はいで行き先の段へ進む
// 引いた地図で線を押したときは、駅の間を決めずに、まずそのあたりへ寄る

const screenshotDir = fileURLToPath(new URL("../screenshots/line-tap/", import.meta.url));
test.setTimeout(120_000);

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" }]);
});

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(size, () => {
    test.use({ viewport });

    test("引いた地図で線を押すと寄り、寄った地図で塚本と尼崎の間の線を押すと尋ね、はいで行き先へ進む", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
        timeout: 30_000,
      });
      await expectStage(page, "position");
      // 価値の 3 行は地図の上端を覆うので、線を押す前に閉じる
      await page.getByTestId(testIds.start.introClose).click();
      await waitForMapStill(page);
      // 引いた地図で塚本と尼崎のあたりの線を押すと、段はそのままで、駅の印が出る倍率まで寄る
      await page.locator(".maplibregl-canvas").focus();
      const far = await panTo(page, betweenTsukamotoAmagasaki, {
        x: viewport.width / 2,
        y: viewport.height * 0.22,
      });
      expect(await readZoom(page)).toBeLessThan(12.5);
      const open = await findCanvasPointNear(page, far);
      await page.mouse.click(open.x, open.y);
      await waitForMapStill(page);
      await expectStage(page, "position");
      expect(await readZoom(page)).toBeGreaterThanOrEqual(12.5);
      await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveCount(0);
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-detail", "stations");

      // 寄った地図で塚本と尼崎の間の線を押す。押しやすいよう、さらに寄せて地図の上の方へ動かす
      await zoomOn(page, betweenTsukamotoAmagasaki, 15);
      const middle = await panTo(page, betweenTsukamotoAmagasaki, {
        x: viewport.width / 2,
        y: viewport.height * 0.22,
      });

      // 線を押すと、その駅の間か尋ねる。段は最初の段のまま
      await page.mouse.click(middle.x, middle.y);
      await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveText(
        "JR神戸線の塚本〜尼崎の間ですか",
      );
      await expectStage(page, "position");
      // 位置の扱いの説明は、どの経路でも出さない
      await expect(page.getByText("位置は端末の中で候補を出すだけに使い、送らない。")).toHaveCount(
        0,
      );
      // はいは主のボタンの塗りにし、違うと見分けられるようにする
      const fill = (testId: string) =>
        page.getByTestId(testId).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(await fill(testIds.start.gpsConfirm)).not.toBe(await fill(testIds.start.gpsDismiss));
      await waitForMapStill(page);
      // 地図を動かした後は、問いが出てシートの高さが変わっても、見ている所を保つ
      expect(await readZoom(page)).toBeGreaterThanOrEqual(15);
      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: `${screenshotDir}between-question-${size}.png` });

      // はいで路線・方面・駅の間の段を飛ばして行き先へ進む
      await page.getByTestId(testIds.start.gpsConfirm).click();
      await expectStage(page, "destination");
      await expect(page.locator("[data-testid^='start-line-']")).toHaveCount(0);
      await expect(page.getByTestId(testIds.start.trainSegment)).toHaveCount(0);

      // 戻ると最初の段に戻る
      await page.getByTestId(testIds.start.back).click();
      await expectStage(page, "position");
    });
  });
}

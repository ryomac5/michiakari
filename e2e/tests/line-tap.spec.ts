import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  betweenTsukamotoAmagasaki,
  dragTo,
  expectStage,
  findCanvasPointNear,
  panTo,
  readZoom,
  waitForMapStill,
  zoomOn,
} from "../support/map-view.ts";
import { expect, test } from "../support/test.ts";

// 最初の地図で駅と駅の間の線を押すと、その駅の間の車内にいるか確かめ、はいで行き先の段へ進む
// 引いた地図で線を押したときも、駅の間の候補を出し、候補の区間が入る所まで寄る

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

    test("引いた地図で線を押すと候補を出して寄り、寄った地図で塚本と尼崎の間の線を押すと尋ね、はいで行き先へ進む", async ({
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
      // 引いた地図で塚本と尼崎のあたりの線を押すと、段はそのままで駅の間の候補を出し、候補が入る所まで寄る。引きはしない
      await page.locator(".maplibregl-canvas").focus();
      const far = await panTo(page, betweenTsukamotoAmagasaki, {
        x: viewport.width / 2,
        y: viewport.height * 0.22,
      });
      const farZoom = await readZoom(page);
      expect(farZoom).toBeLessThan(12.5);
      const open = await findCanvasPointNear(page, far);
      await page.mouse.click(open.x, open.y);
      await waitForMapStill(page);
      await expectStage(page, "position");
      expect(await readZoom(page)).toBeGreaterThanOrEqual(farZoom - 0.01);
      // 候補が 1 件なら問いで、複数なら一覧で出る
      const farChoice = page
        .getByTestId(testIds.start.gpsQuestion)
        .or(
          page
            .locator("[data-testid^='start-gps-choice-']")
            .filter({ hasText: "JR神戸線の塚本〜尼崎の間" }),
        );
      await expect(farChoice).toContainText("JR神戸線の塚本〜尼崎の間");

      // 寄った地図で塚本と尼崎の間の線を押す。押しやすいよう、さらに寄せる
      // 候補が出てシートが高いので、指で引いて、上部の帯とシートの間の中ほどへ動かす
      await page.locator(".maplibregl-canvas").focus();
      await zoomOn(page, betweenTsukamotoAmagasaki, 15);
      const sheetTop = (await page.getByTestId(testIds.start.sheet).boundingBox())?.y ?? 0;
      const middle = await dragTo(
        page,
        betweenTsukamotoAmagasaki,
        { x: viewport.width / 2, y: (72 + sheetTop) / 2 },
        { top: 72, bottom: sheetTop },
      );
      expect(middle.y).toBeLessThan(sheetTop);

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

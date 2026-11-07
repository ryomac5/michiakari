import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { chooseBetweenStations } from "../support/entry.ts";
import { waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 電車の中の人にだけ、原因の後で「信号を受信したため緊急停止」の放送を聞いたかを聞く
// あったと答えたら、その放送の文を観測に足して判断へ送る。決定論モードの agent とダミーの内容で確かめる

// 判断に送る放送の文。apps/web/src/features/situation/protection-broadcast.ts と同じ
const protectionBroadcastText = "危険を知らせる信号を受信したため、緊急停止しました";

const screenshotRoot = fileURLToPath(new URL("../screenshots/entry-protection/", import.meta.url));

function expectStage(page: Page, stage: string) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

// 大阪から JR 神戸線で三ノ宮へ向かう途中、大阪と塚本の間で止まった。原因の問いまで進める
async function reachCause(page: Page): Promise<void> {
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  const screen = page.getByTestId(testIds.start.screen);
  await expect(screen).toHaveAttribute("data-stage", /^(cause|direction)$/);
  if ((await screen.getAttribute("data-stage")) === "direction")
    await page.locator("[data-testid^='start-direction-'][data-testid$='.神戸']").click();
  await expectStage(page, "cause");
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`受信の放送の問い ${size}`, () => {
    test.use({ viewport, deviceScaleFactor: 2 });
    test.setTimeout(120_000);

    test("電車の中・駅の間で「あった」と選ぶと、放送の文を観測に入れて判断まで進む", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
        timeout: 30_000,
      });
      await chooseBetweenStations(page, "JR神戸線", "大阪", "塚本");
      await reachCause(page);
      await page.getByTestId(testIds.start.cause("unknown")).click();

      await expectStage(page, "protection");
      await expect(page.getByTestId(testIds.start.sheet)).toContainText(
        "止まったとき「信号を受信したため緊急停止」のような放送はありましたか",
      );
      const answers = page.locator("[data-testid^='start-protection-']");
      await expect(answers).toHaveText(["あった", "なかった", "覚えていない"]);
      for (const answer of await answers.all()) await expect(answer).toBeInViewport();
      await waitForFiniteAnimations(page);
      mkdirSync(screenshotRoot, { recursive: true });
      await page.screenshot({ path: `${screenshotRoot}${size}.png` });

      // 戻ると答える前の問いに戻り、地図の行き先の段まで引いてもまた進める
      await page.getByTestId("start-protection-heard").click();
      await expectStage(page, "elapsed");
      await page.getByTestId(testIds.start.back).click();
      await expectStage(page, "protection");
      await page.getByTestId(testIds.start.back).click();
      await expectStage(page, "cause");
      await page.getByTestId(testIds.start.back).click();
      await expectStage(page, "destination");
      await reachCause(page);
      await page.getByTestId(testIds.start.cause("unknown")).click();

      await page.getByTestId("start-protection-heard").click();
      await page.getByTestId(testIds.start.elapsed("now")).click();
      const request = page.waitForRequest(
        (r) => r.method() === "POST" && new URL(r.url()).pathname === "/judge",
      );
      await page.getByTestId(testIds.start.resume("unknown")).click();
      await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
      await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({
        timeout: 30_000,
      });
      const body = (await request).postDataJSON() as {
        observations: { kind?: string; rawText?: string }[];
      };
      expect(body.observations).toContainEqual(
        expect.objectContaining({ kind: "station_broadcast", rawText: protectionBroadcastText }),
      );
      await page.screenshot({ path: `${screenshotRoot}${size}-judgment.png` });
    });
  });
}

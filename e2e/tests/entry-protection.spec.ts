import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { expectJudgmentOpened, openAddInfo, waitForJudgmentReady } from "../support/add-info.ts";
import { chooseBetweenStations } from "../support/entry.ts";
import { waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 電車の中の人にだけ、情報を追加するで「信号を受信したため緊急停止」の放送を聞いたかを足せる
// あったと答えたら、その放送の文を観測に足して判断を出し直す。決定論モードの agent とダミーの内容で確かめる

// 判断に送る放送の文。apps/web/src/features/situation/protection-broadcast.ts と同じ
const protectionBroadcastText = "危険を知らせる信号を受信したため、緊急停止しました";

const screenshotRoot = fileURLToPath(new URL("../screenshots/entry-protection/", import.meta.url));

// 大阪から JR 神戸線で三ノ宮へ向かう途中、大阪と塚本の間で止まった。行き先まで答えて判断を出す
async function reachJudgment(page: Page): Promise<void> {
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await expectJudgmentOpened(page);
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`受信の放送の問い ${size}`, () => {
    test.use({ viewport, deviceScaleFactor: 2 });
    test.setTimeout(120_000);

    test("電車の中・駅の間で情報を追加するから「あった」と足すと、放送の文を観測に入れて判断を出し直す", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
        timeout: 30_000,
      });
      await chooseBetweenStations(page, "JR神戸線", "大阪", "塚本");
      await reachJudgment(page);

      let addInfo = await openAddInfo(page);
      await addInfo.getByTestId(testIds.situation.item("protection")).click();
      await expect(addInfo).toContainText("「信号を受信したため緊急停止」の放送");
      const answers = addInfo.locator("[data-testid^='situation-protection-']");
      await expect(answers).toHaveText(["あった", "なかった", "覚えていない"]);
      for (const answer of await answers.all()) {
        await answer.scrollIntoViewIfNeeded();
        await expect(answer).toBeInViewport();
      }
      await waitForFiniteAnimations(page);
      mkdirSync(screenshotRoot, { recursive: true });
      await page.screenshot({ path: `${screenshotRoot}${size}.png` });

      // 戻ると足せる項目の札に戻り、もう一度開いて答えられる
      await addInfo.getByTestId(testIds.situation.back).click();
      await expect(answers).toHaveCount(0);
      await addInfo.getByTestId(testIds.situation.item("protection")).click();

      const request = page.waitForRequest(
        (r) => r.method() === "POST" && new URL(r.url()).pathname === "/judge",
      );
      await addInfo.getByTestId(testIds.situation.option("protection", "heard")).click();
      const body = (await request).postDataJSON() as {
        observations: { kind?: string; rawText?: string }[];
      };
      expect(body.observations).toContainEqual(
        expect.objectContaining({ kind: "station_broadcast", rawText: protectionBroadcastText }),
      );
      await waitForJudgmentReady(page);
      await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible();

      // 足した答えは札に残る
      addInfo = await openAddInfo(page);
      await expect(addInfo.getByTestId(testIds.situation.answer("protection"))).toContainText(
        "あった",
      );
      await expect(addInfo.getByTestId(testIds.situation.item("protection"))).toHaveCount(0);
      await page.screenshot({ path: `${screenshotRoot}${size}-judgment.png` });
    });
  });
}

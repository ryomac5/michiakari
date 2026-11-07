import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { addAnswers, expectJudgmentAfterDirection } from "../support/add-info.ts";
import { chooseBetweenStations } from "../support/entry.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 入口で受信の放送を「あった」と答えると、判断の画面に防護無線の読みが出る
// 決定論モードの agent とダミーの内容で確かめる

const screenshotRoot = fileURLToPath(new URL("../screenshots/rules/", import.meta.url));

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(150_000);

// 大阪から JR 神戸線で三ノ宮へ向かう途中、大阪と塚本の間で止まった。判断が出てから受信の放送を聞いたと足す
async function startWithProtectionHeard(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await chooseBetweenStations(page, "JR神戸線", "大阪", "塚本");
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await expectJudgmentAfterDirection(page, "神戸");
  await addAnswers(page, { protection: "heard", elapsed: "now", resume: "unknown" });
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
}

test("受信の放送を「あった」と足すと、判断の見出しの下に防護無線の読みが出る", async ({ page }) => {
  await startWithProtectionHeard(page);
  await expect(page.getByTestId(testIds.judgment.protection)).toHaveText(
    "近くで非常停止があったと読めます",
  );
});

// 画面の画像のための見込みの欄。支障の無い線路と詰まりは決まった値で上書きする
// 止まった区間が分からないと agent は詰まりの本数を数えないので、画像のために値を置く
const outlookFields = {
  cues: ["protection_received"],
  protection: true,
  unaffectedTrack: {
    trackSide: "unknown",
    affected: { p50: 60, p80: 90 },
    opposite: { p50: 10, p80: 15 },
  },
  resumeQueue: {
    closesUp: true,
    trainsInQueue: 2,
    waitRange: { minMinutes: 6, maxMinutes: 10 },
    queueAnnounced: false,
    worthAlightingAtNextStation: true,
  },
};

// 判断の SSE の judgment_ready に、画像のための欄を上書きして返す
async function fillOutlookFields(route: Route): Promise<void> {
  const response = await route.fetch();
  const body = (await response.text())
    .split("\n")
    .map((line) => {
      if (!line.startsWith("data: ")) return line;
      const event = JSON.parse(line.slice(6)) as { type: string; judgment?: object };
      if (event.type !== "judgment_ready" || !event.judgment) return line;
      return `data: ${JSON.stringify({ ...event, judgment: { ...event.judgment, ...outlookFields } })}`;
    })
    .join("\n");
  await route.fulfill({ response, body });
}

async function capture(page: Page, theme: string, name: string): Promise<void> {
  await waitForFiniteAnimations(page);
  const dir = `${screenshotRoot}${theme}/`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}${name}.png` });
}

for (const theme of ["light", "dark"] as const) {
  test(`新しい見込みの表示の画像 ${theme}`, async ({ page, context, baseURL }) => {
    await context.addCookies([
      { name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" },
      { name: "theme", value: theme, url: baseURL ?? "" },
    ]);
    await page.route(
      (url) => url.pathname === "/judge",
      (route) => fillOutlookFields(route),
    );
    await startWithProtectionHeard(page);

    await expect(page.getByTestId(testIds.judgment.protection)).toBeVisible();
    await capture(page, theme, "01-closed");

    // 半分まで開くと、支障の無い線路の 2 行と詰まりの行が見える
    await openSheet(page, "half");
    const outlook = page.getByTestId(testIds.judgment.ruleOutlook);
    await outlook.scrollIntoViewIfNeeded();
    await expect(page.getByTestId(testIds.judgment.trackLine("opposite"))).toContainText(
      "確かめが済めば10〜15分ほどで動き出すことがあります",
    );
    await expect(page.getByTestId(testIds.judgment.trackLine("affected"))).toContainText(
      "長く止まる見込みです",
    );
    await expect(page.getByTestId(testIds.judgment.queueWait)).toHaveText(
      "動き出しても、前の列車が詰まり、先へ進むまで6〜10分ほどかかる見込みです",
    );
    await expect(page.getByTestId(testIds.judgment.queueAlight)).toHaveText(
      "次の駅で降りて乗り換える選択肢もあります",
    );
    await capture(page, theme, "02-half");

    // 全部開くと、詰まりの行と降りる行まで見える
    await openSheet(page, "full");
    await page.getByTestId(testIds.judgment.queueAlight).scrollIntoViewIfNeeded();
    await capture(page, theme, "03-outlook");

    // 根拠の欄を開くと、受信の放送から読める手がかりが出る
    const evidence = page.getByTestId(testIds.judgment.evidence);
    await page.getByTestId(testIds.judgment.evidenceToggle).click();
    await evidence.scrollIntoViewIfNeeded();
    await expect(evidence.locator("[data-cue-id='protection_received']")).toBeVisible();
    await capture(page, theme, "04-evidence");
  });
}

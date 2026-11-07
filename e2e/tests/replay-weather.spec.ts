/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  loadReplayScenarios,
  openReplay,
  openSheet,
  splitScenariosByWeather,
  waitForFiniteAnimations,
  waitForJudged,
} from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 雨量の推移のグラフ（デモ台本 1:50〜2:05）
// 気象を使う事象かどうかは core の事象の種類で決め、シナリオ ID は書かない

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));
const viewport = { width: 390, height: 844 };
const { weather: weatherScenarios, other: otherScenarios } = splitScenariosByWeather(
  loadReplayScenarios(),
);
const trends = ["rising", "falling", "steady", "unknown"];

test.use({ viewport, deviceScaleFactor: 2 });
test.setTimeout(180_000);

// グラフの観測の数と、描いた棒・欠測の印の数
async function readChart(page: Page) {
  const panel = page.getByTestId(testIds.judgment.weather);
  const count = Number(await panel.getAttribute("data-reading-count"));
  const bars = await panel.locator("rect[data-bar]").count();
  const missing = await panel.locator("rect[data-missing]").count();
  return { count, bars, missing };
}

// 閉じたシートに結論と分岐点が収まっていること
async function expectConclusionInFirstViewport(page: Page, label: string) {
  await waitForFiniteAnimations(page);
  for (const id of [testIds.judgment.conclusion, testIds.judgment.breakEven]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, `${label}: ${id}`).not.toBeNull();
    expect((box?.y ?? 0) + (box?.height ?? 0), `${label}: ${id}`).toBeLessThanOrEqual(
      viewport.height,
    );
  }
}

test("気象を使う事象と使わない事象のシナリオが 1 本以上ずつある", () => {
  expect(weatherScenarios.length).toBeGreaterThan(0);
  expect(otherScenarios.length).toBeGreaterThan(0);
});

for (const scenario of weatherScenarios) {
  for (const locale of ["ja", "en"] as const) {
    test(`シナリオ ${scenario.id}（${locale}）: 観測ごとに雨量のグラフが出て、棒が足されていく`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL ?? "" }]);
      await openReplay(page, scenario.id);
      const panel = page.getByTestId(testIds.judgment.weather);
      const counts: number[] = [];
      const shotAfter =
        scenario.expectations.find((e) => e.action === "wait")?.after ??
        scenario.timeline.at(-1)?.id;

      for (const entry of scenario.timeline) {
        await page.getByTestId(testIds.replay.nextButton).click();
        await waitForJudged(page, entry.id);
        const label = `${entry.id} の後`;
        await expect(panel, label).toBeVisible();
        await expect(panel).toHaveAttribute("data-stale", "false");
        expect(trends, label).toContain(await panel.getAttribute("data-trend"));

        const chart = await readChart(page);
        expect(chart.count, label).toBeGreaterThan(0);
        // 観測 1 件につき、棒か欠測の印のどちらか 1 つ
        expect(chart.bars + chart.missing, label).toBe(chart.count);
        counts.push(chart.count);

        await expect(page.getByTestId(testIds.judgment.weatherTrend)).not.toBeEmpty();
        await expect(page.getByTestId(testIds.judgment.weatherWarnings)).not.toBeEmpty();
        await expect(page.getByTestId(testIds.judgment.weatherSummary)).not.toBeEmpty();
        await expect(panel).toContainText(
          locale === "ja" ? "気象データ: 気象庁" : "Weather data: Japan Meteorological Agency",
        );
        await expect(page.getByTestId(testIds.judgment.weatherFictional)).toHaveText(
          locale === "ja" ? "架空のシナリオの値" : "Fictional scenario values",
        );
        // 最後まで流れると結末のカードが先頭に出るので、その手前の観測で確かめる
        const ended =
          (await page.getByTestId(testIds.replay.screen).getAttribute("data-state")) === "ended";
        if (!ended) await expectConclusionInFirstViewport(page, label);

        // 待つ判断に変わった観測で、シートを半分まで開いてグラフを撮る
        if (entry.id === shotAfter) {
          await openSheet(page, "half");
          await expect(panel).toBeInViewport();
          await page.screenshot({
            path: `${screenshotDir}replay-weather-${scenario.id}-${locale}-390x844.png`,
          });
          await openSheet(page, "collapsed");
        }
      }

      // 観測が進むと棒は減らず、最初より増えている
      counts.forEach((c, i) => {
        expect(c, `観測 ${i + 1} 件目の棒の数: ${counts.join(" → ")}`).toBeGreaterThanOrEqual(
          counts[i - 1] ?? 0,
        );
      });
      expect(counts.at(-1) ?? 0, counts.join(" → ")).toBeGreaterThan(counts[0] ?? 0);

      // グラフの高さは 64〜80px に収める
      const chartBox = await page.getByTestId(testIds.judgment.weatherChart).boundingBox();
      expect(chartBox?.height ?? 0).toBeGreaterThanOrEqual(64);
      expect(chartBox?.height ?? 0).toBeLessThanOrEqual(80);
    });
  }
}

for (const scenario of otherScenarios) {
  test(`シナリオ ${scenario.id}: 気象を使わない事象では雨量のグラフを出さない`, async ({
    page,
  }) => {
    await openReplay(page, scenario.id);
    for (const entry of scenario.timeline) {
      await page.getByTestId(testIds.replay.nextButton).click();
      await waitForJudged(page, entry.id);
      await expect(page.getByTestId(testIds.judgment.weather), `${entry.id} の後`).toHaveCount(0);
    }
  });
}

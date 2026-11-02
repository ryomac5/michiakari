/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { ISOCHRONE_MINUTES } from "../../packages/geo/src/index.ts";
import { loadGeoIndex } from "../../packages/geo/src/node.ts";
import {
  loadReplayScenarios,
  openReplay,
  waitForFiniteAnimations,
  waitForJudged,
} from "../support/replay.ts";

// 地図の徒歩の到達範囲。出発駅に Valhalla の事前計算があれば多角形、無ければ円の概算で描く

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));
// 主役のシナリオ: 期待値に switch を含む最初のもの
const scenario = loadReplayScenarios().find((s) =>
  s.expectations.some((e) => e.action === "switch"),
);

// 出発駅と同じ名前の駅のどれかに、10 分と 20 分の範囲がそろっているか
function hasIsochrone(stationName: string): boolean {
  const geo = loadGeoIndex();
  return geo
    .findStationsByName(stationName, 200)
    .filter((s) => s.name === stationName)
    .some((s) => ISOCHRONE_MINUTES.every((m) => geo.getIsochrone(s.stationId, m) !== null));
}

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(120_000);

test("主役シナリオの出発駅の到達範囲を、事前計算があれば多角形で描き、出典を 1 行で示す", async ({
  page,
}) => {
  if (!scenario) throw new Error("switch を含むシナリオがありません");
  const first = scenario.timeline[0];
  if (!first) throw new Error("シナリオに観測がありません");
  const polygon = hasIsochrone(scenario.user.current_station);

  await openReplay(page, scenario.id);
  await page.getByTestId(testIds.replay.nextButton).click();
  await waitForJudged(page, first.id);

  const map = page.getByTestId(testIds.judgment.map);
  await map.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(map).toHaveAttribute("data-reach-source", polygon ? "valhalla" : "circle");
  // 凡例の「概算」は円で描いたときだけ出る
  await expect(page.getByTestId(mapTestIds.reachApprox)).toHaveCount(polygon ? 0 : 1);

  // 出典は徒歩経路の文言を含み、見える行はスマホ幅で 1 行に収まる
  const attribution = page.getByTestId(mapTestIds.attribution);
  await expect(attribution).toContainText("国土地理院");
  await expect(attribution).toContainText("Valhalla で計算");
  await expect(attribution.getByRole("link")).toHaveAttribute("href", "/about");
  const line = page.getByTestId(mapTestIds.attributionLine);
  const overflow = await line.evaluate((el) => ({
    lines: Math.round(el.clientHeight / Number.parseFloat(getComputedStyle(el).lineHeight)),
    clipped: el.scrollWidth > el.clientWidth,
  }));
  expect(overflow).toEqual({ lines: 1, clipped: false });

  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}judgment-map-reach-390x844.png` });
});

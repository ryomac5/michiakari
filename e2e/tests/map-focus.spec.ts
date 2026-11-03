/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import {
  loadReplayScenarios,
  openReplay,
  waitForFiniteAnimations,
  waitForJudged,
} from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 現在地のまわりの地図。乗り換え候補の駅を吹き出しで出し、「全体を見る」で経路の全体に切り替える
// 大阪駅は手で整えた範囲を使い、ほかの駅は駅データから候補を自動で選ぶ

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));
const scenarios = loadReplayScenarios();
// 大阪駅を現在地にし、待つから切り替えるへ変わるシナリオ
const osaka = scenarios.find(
  (s) => s.user.current_station === "大阪" && s.expectations.some((e) => e.action === "switch"),
);
const elsewhere = scenarios.find((s) => s.user.current_station !== "大阪");

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(180_000);

async function stepTo(page: Page, observationId: string): Promise<void> {
  if (!osaka) throw new Error("大阪駅のシナリオがありません");
  const shown = await page.getByTestId(testIds.replay.judgment).getAttribute("data-observation-id");
  const start = osaka.timeline.findIndex((e) => e.id === shown) + 1;
  for (const entry of osaka.timeline.slice(start)) {
    await page.getByTestId(testIds.replay.nextButton).click();
    await waitForJudged(page, entry.id);
    if (entry.id === observationId) return;
  }
  throw new Error(`観測 ${observationId} まで進めませんでした`);
}

const stations = (page: Page) => page.locator(`[data-testid^="judgment-map-station-"]`);

test("大阪駅では現在地のまわりに寄せ、乗り換え候補の駅を吹き出しで出す", async ({ page }) => {
  if (!osaka) throw new Error("大阪駅のシナリオがありません");
  const first = osaka.timeline[0];
  const switchAfter = osaka.expectations.find((e) => e.action === "switch")?.after;
  if (!first || !switchAfter) throw new Error("観測がありません");

  await openReplay(page, osaka.id);
  await stepTo(page, first.id);
  const map = page.getByTestId(testIds.judgment.map);
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(map).toHaveAttribute("data-view", "focus");
  await expect(map).toHaveAttribute("data-focus-area", "umeda");

  // 現在地と、徒歩の分数・運行の状態を持つ候補の駅が出る
  await expect(page.getByTestId(mapTestIds.here)).toBeVisible();
  await expect(page.getByTestId(mapTestIds.here)).toContainText("大阪駅");
  await expect.poll(() => stations(page).count()).toBeGreaterThanOrEqual(3);
  for (const station of await stations(page).all()) {
    await expect(station).toBeVisible();
    await expect(station).toHaveAttribute("data-walk-minutes", /^\d+$/);
    await expect(station).toHaveAttribute("data-status", /^(running|suspended)$/);
  }
  // 推奨が無いうちは、おすすめの印は付かない
  await expect(stations(page).and(page.locator("[data-recommended='true']"))).toHaveCount(0);
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}map-focus-first-390x844.png` });

  // 切り替えに変わると、推奨の選択肢が最初に乗る駅におすすめの印が付く
  await stepTo(page, switchAfter);
  await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
    "data-action",
    "switch",
  );
  await expect(map).toHaveAttribute("data-view", "focus");
  const recommended = stations(page).and(page.locator("[data-recommended='true']"));
  await expect(recommended).toHaveCount(1);
  await expect(recommended).toBeVisible();
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}map-focus-switch-390x844.png` });

  // おすすめの吹き出しの路線は、推奨の選択肢の最初の乗車区間と、選択肢の名前の路線に一致する
  const optionId = await map.getAttribute("data-recommended-option");
  const recommendedOption = page.getByTestId(testIds.judgment.option(optionId ?? ""));
  const firstLine = await recommendedOption.getAttribute("data-first-line");
  const mainLine = await recommendedOption.getAttribute("data-main-line");
  expect(firstLine).not.toBe("");
  await expect(recommended).toHaveAttribute("data-route-line", firstLine ?? "");
  await expect(recommended).toHaveAttribute("data-route-main-line", mainLine ?? "");

  // 吹き出しを押すと、シートが開いてその選択肢が目立つ
  await recommended.click();
  await expect(page.getByTestId(testIds.judgment.sheet)).toHaveAttribute("data-snap", "full");
  const option = page.getByTestId(testIds.judgment.option(optionId ?? ""));
  await expect(option).toHaveAttribute("data-highlighted", "true");
  await expect(option).toBeInViewport();
  // 選択肢の行にも、吹き出しと同じ駅が添えてある
  const key = (await recommended.getAttribute("data-testid"))?.replace("judgment-map-station-", "");
  await expect(option).toHaveAttribute("data-station", key ?? "");
});

test("「全体を見る」で経路の全体に切り替え、もう一度押すと現在地のまわりに戻る", async ({
  page,
}) => {
  if (!osaka) throw new Error("大阪駅のシナリオがありません");
  const first = osaka.timeline[0];
  if (!first) throw new Error("観測がありません");
  await openReplay(page, osaka.id);
  await stepTo(page, first.id);
  const map = page.getByTestId(testIds.judgment.map);
  const toggle = page.getByTestId(mapTestIds.viewToggle);
  await expect(map).toHaveAttribute("data-view", "focus");

  await toggle.click();
  await expect(map).toHaveAttribute("data-view", "overview");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(stations(page)).toHaveCount(0);
  await expect(page.getByTestId(mapTestIds.here)).toHaveCount(0);
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}map-overview-390x844.png` });

  await toggle.click();
  await expect(map).toHaveAttribute("data-view", "focus");
  // 吹き出しは見せ方が切り替わった次の描画で付くので、出そろうまで待つ
  await expect.poll(() => stations(page).count()).toBeGreaterThanOrEqual(3);
});

test("手で整えた範囲の外の駅でも、駅データから選んだ乗り換え候補を吹き出しで出す", async ({
  page,
}) => {
  if (!elsewhere) throw new Error("大阪駅以外のシナリオがありません");
  const first = elsewhere.timeline[0];
  if (!first) throw new Error("観測がありません");
  await openReplay(page, elsewhere.id);
  await page.getByTestId(testIds.replay.nextButton).click();
  await waitForJudged(page, first.id);
  const map = page.getByTestId(testIds.judgment.map);
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(map).toHaveAttribute("data-view", "focus");
  await expect(map).toHaveAttribute("data-focus-area", /^auto:/);
  await expect(page.getByTestId(mapTestIds.here)).toBeVisible();
  const count = await stations(page).count();
  expect(count).toBeGreaterThanOrEqual(1);
  expect(count).toBeLessThanOrEqual(4);
  for (const station of await stations(page).all()) {
    await expect(station).toHaveAttribute("data-walk-minutes", /^\d+$/);
  }
  // 「全体を見る」で全体に切り替えられる
  await page.getByTestId(mapTestIds.viewToggle).click();
  await expect(map).toHaveAttribute("data-view", "overview");
});

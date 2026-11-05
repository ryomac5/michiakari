/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import {
  loadReplayScenarios,
  openReplay,
  openSheet,
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

async function expectLabelsApart(labels: Locator): Promise<void> {
  await expect
    .poll(() =>
      labels.evaluateAll((elements) => elements.filter((el) => el.checkVisibility()).length),
    )
    .toBeGreaterThan(1);
  await expect
    .poll(() =>
      labels.evaluateAll((elements) => {
        const boxes = elements
          .filter((el) => el.checkVisibility())
          .map((el) => ({ name: el.textContent, rect: el.getBoundingClientRect() }));
        if (boxes.length < 2) return ["表示中の札が2枚未満"];
        return boxes.flatMap((a, i) =>
          boxes.slice(i + 1).flatMap((b) => {
            const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
            const height =
              Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
            return width > 0 && height > 0
              ? [`${a.name} / ${b.name}: ${width.toFixed(2)}×${height.toFixed(2)}px`]
              : [];
          }),
        );
      }),
    )
    .toEqual([]);
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}×${viewport.height} の地図の札`, () => {
    test.use({ viewport });

    for (const scenario of scenarios) {
      test(`判断画面の札が重ならない: ${scenario.id}`, async ({ page }) => {
        await openReplay(page, scenario.id);
        for (const entry of scenario.timeline) {
          await page.getByTestId(testIds.replay.nextButton).click();
          await waitForJudged(page, entry.id);
          await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute(
            "data-state",
            "ready",
            {
              timeout: 30_000,
            },
          );
          await waitForFiniteAnimations(page);
          await expect(
            page.getByTestId(mapTestIds.here).locator(":scope > [data-placement]"),
          ).toBeVisible();
          const recommendedId = await page
            .getByTestId(testIds.judgment.map)
            .getAttribute("data-recommended-option");
          if (recommendedId) {
            const key = await page
              .getByTestId(testIds.judgment.option(recommendedId))
              .getAttribute("data-station");
            if (key && key !== "here") {
              const recommended = page.getByTestId(mapTestIds.station(key));
              await expect(recommended).toHaveAttribute("data-recommended", "true");
              await expect(recommended).toBeVisible();
            }
          }
          await expectLabelsApart(
            page.locator(
              // ボタンの 44px のタップ領域ではなく、表示している札の面を測る
              '[data-testid="judgment-map-here"] > [data-placement], [data-testid="judgment-map-alight"] > [data-placement], button[data-testid^="judgment-map-station-"] > span, div[data-testid^="judgment-map-station-"], [data-testid="judgment-map-blocked-tag"]',
            ),
          );
        }
      });
    }

    test("入口の関西・エリア・駅の札が重ならない", async ({ page }) => {
      await page.goto("/?mock=1");
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
        timeout: 30_000,
      });
      await page.getByTestId(testIds.start.positionStation).click();
      const labels = page.locator(
        '[data-testid^="start-hub-"] > span[aria-hidden], [data-testid^="start-place-"] > span[aria-hidden], [data-testid^="start-map-stop-"] > span[aria-hidden], [data-testid^="start-hub-edge-"]',
      );
      await waitForFiniteAnimations(page);
      await expectLabelsApart(labels);
      await page.getByTestId(testIds.start.hub("umeda")).click();
      await expect(page.getByTestId(testIds.start.place("osaka"))).toBeVisible();
      await waitForFiniteAnimations(page);
      await expectLabelsApart(labels);
      await page.getByTestId(testIds.start.place("osaka")).click();
      await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute(
        "data-stage",
        "destination",
      );
      await waitForFiniteAnimations(page);
      await expectLabelsApart(labels);
    });
  });
}

test("大阪駅では現在地のまわりに寄せ、乗り換え候補の駅を吹き出しで出す", async ({ page }) => {
  if (!osaka) throw new Error("大阪駅のシナリオがありません");
  // 切り替え以外の判断になる最初の観測と、そのあとで切り替えに変わる観測
  // 発生直後から切り替えを言い切るシナリオもあるので、最初の観測とは限らない
  const calmIndex = osaka.expectations.findIndex(
    (e) => e.action !== undefined && e.action !== "switch",
  );
  const calm = osaka.expectations[calmIndex];
  const switchAfter = osaka.expectations
    .slice(calmIndex + 1)
    .find((e) => e.action === "switch")?.after;
  if (!calm || !switchAfter) throw new Error("観測がありません");

  await openReplay(page, osaka.id);
  await stepTo(page, calm.after);
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

  // ほかの選択肢の行を押すと、シートを閉じて地図をその選択肢の経路と乗る駅に描き直す
  const other = page
    .locator(
      `[data-testid^='judgment-option-'][data-recommended='false']:not([data-station='']):not([data-station='here']):not([data-station='${key}'])`,
    )
    .first();
  const otherId = (await other.getAttribute("data-testid"))?.replace("judgment-option-", "") ?? "";
  const otherKey = (await other.getAttribute("data-station")) ?? "";
  expect(otherId).not.toBe("");
  await other.getByRole("button").click();
  await expect(page.getByTestId(testIds.judgment.sheet)).toHaveAttribute("data-snap", "collapsed");
  await expect(map).toHaveAttribute("data-selected-option", otherId);
  await expect(map).toHaveAttribute("data-recommended-option", optionId ?? "");
  await expect(other).toHaveAttribute("data-selected", "true");
  // 地図の見方の経路の色も、地図と同じ選択中の選択肢の色になる
  const otherKind = (await other.getAttribute("data-kind")) ?? "";
  const otherTone = otherKind === "wait" ? "wait" : "switch";
  await expect(map).toHaveAttribute("data-route-tone", otherTone);
  await expect(page.getByTestId(mapTestIds.legend)).toHaveAttribute("data-tone", otherTone);
  const selected = page.getByTestId(mapTestIds.station(otherKey));
  await expect(selected).toHaveAttribute("data-recommended", "true");
  // おすすめの星は推奨の選択肢の駅に残す
  await expect(selected).toHaveAttribute("data-starred", "false");
  await expect(page.getByTestId(mapTestIds.station(key ?? ""))).toHaveAttribute(
    "data-starred",
    "true",
  );
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}map-focus-selected-390x844.png` });

  // 待つ選択肢を選ぶと、地図の経路と地図の見方の色がどちらも待つ色に変わる
  await openSheet(page, "full");
  const waitOption = page.locator("[data-testid^='judgment-option-'][data-kind='wait']").first();
  await waitOption.getByRole("button").click();
  await expect(map).toHaveAttribute("data-route-tone", "wait");
  await expect(page.getByTestId(mapTestIds.legend)).toHaveAttribute("data-tone", "wait");
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

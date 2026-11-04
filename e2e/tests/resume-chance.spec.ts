/// <reference lib="dom" />
// page 内で動かす関数（evaluateAll）のために DOM の型を読む
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { openReplay, waitForFiniteAnimations, waitForJudged } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 時刻ごとの再開の見込みの帯と、待ったほうが早く着く見込み
// 決定論モードの agent とダミーの内容で確かめる。判断の画面はライトとダークの両方で撮る

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));
const tickSelector = "[data-testid^='judgment-resume-chance-tick-']";

type Tick = { tenths: number; sinceOnset: number | null; side: string; label: string };

async function readTicks(page: Page): Promise<Tick[]> {
  return page.locator(tickSelector).evaluateAll((els) =>
    els.map((el) => {
      const onset = el.getAttribute("data-since-onset") ?? "";
      return {
        tenths: Number(el.getAttribute("data-tenths")),
        sinceOnset: onset === "" ? null : Number(onset),
        side: el.getAttribute("data-side") ?? "",
        label: el.textContent ?? "",
      };
    }),
  );
}

async function waitForMapReady(page: Page): Promise<void> {
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await waitForFiniteAnimations(page);
}

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(150_000);

for (const theme of ["light", "dark"] as const) {
  test.describe(`表示 ${theme}`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([{ name: "theme", value: theme, url: baseURL ?? "" }]);
    });

    test("人身事故のリプレイの最初の判断では、発生から 1 時間より前の目盛りが 1 割未満になる", async ({
      page,
    }) => {
      await openReplay(page, "person_accident_last_train", 60);
      await page.getByTestId(testIds.replay.nextButton).click();
      await waitForJudged(page, "obs_1");
      await expect(page.locator("html")).toHaveClass(theme);

      const band = page.getByTestId(testIds.judgment.resumeChance);
      await expect(band).toBeVisible();
      await expect(band).toHaveAttribute("data-onset", "known");
      // 待ったほうが早く着く見込みは 1 割未満で、切り替えの結論と向きがそろう
      await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
        "data-action",
        "switch",
      );
      const waitFaster = page.getByTestId(testIds.judgment.resumeChanceWaitFaster);
      await expect(waitFaster).toHaveAttribute("data-tenths", "0");
      await expect(waitFaster).toContainText("1割未満");
      // 期限があるので、待って期限に間に合う見込みも出る
      await expect(page.getByTestId(testIds.judgment.resumeChanceWaitOnTime)).toBeVisible();

      const ticks = await readTicks(page);
      expect(ticks.length).toBeGreaterThanOrEqual(4);
      expect(ticks.length).toBeLessThanOrEqual(6);
      const before = ticks.filter((t) => (t.sinceOnset ?? 0) < 60);
      expect(before.length, "発生から 1 時間より前の目盛り").toBeGreaterThan(0);
      for (const tick of before) {
        expect(tick.tenths).toBe(0);
        expect(tick.label).toContain("1割未満");
      }
      expect(ticks.some((t) => t.tenths >= 5)).toBe(true);
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i]?.tenths ?? 0).toBeGreaterThanOrEqual(ticks[i - 1]?.tenths ?? 0);
      }
      // 分岐点の印が帯の上にあり、分岐点より後の棒は斜線になる
      await expect(page.getByTestId(testIds.judgment.resumeChanceBreakEven)).toBeAttached();
      expect(ticks.some((t) => t.side === "after")).toBe(true);
      // 要点の 1 文は、発生からの言い方で 5 割以上の目盛りを言う
      const lead = page.getByTestId(testIds.judgment.resumeChanceLead);
      await expect(lead).toContainText("発生から");
      await expect(lead).toContainText("見込みで動いています");
      // 理由の最後にも確率の 1 文が入る
      await expect(page.getByTestId(testIds.judgment.conclusionReason)).toContainText(
        "待ったほうが早く着く見込みは1割未満です",
      );
      await waitForMapReady(page);
      await page.screenshot({
        path: `${screenshotDir}resume-chance-person-accident-${theme}-390x844.png`,
      });

      // 再開見込みの発表が届くと、帯と待ったほうが早く着く見込みが変わる
      await page.getByTestId(testIds.replay.nextButton).click();
      await waitForJudged(page, "obs_2");
      await page.getByTestId(testIds.replay.nextButton).click();
      await waitForJudged(page, "obs_3");
      await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
        "data-action",
        "wait",
      );
      const later = await readTicks(page);
      const laterTenths = Number(await waitFaster.getAttribute("data-tenths"));
      expect(laterTenths).toBeGreaterThanOrEqual(5);
      expect(later.map((t) => t.tenths).join(",")).not.toBe(ticks.map((t) => t.tenths).join(","));
    });

    test("車内対応のリプレイでは、発生から 10 分ほどの目盛りが高い確率になる", async ({ page }) => {
      await openReplay(page, "in_car_response_loop", 60);
      await page.getByTestId(testIds.replay.nextButton).click();
      await waitForJudged(page, "obs_1");

      const ticks = await readTicks(page);
      const tenMinutes = ticks.find((t) => t.sinceOnset === 10);
      expect(tenMinutes, "発生から 10 分の目盛り").toBeDefined();
      expect(tenMinutes?.tenths ?? 0).toBeGreaterThanOrEqual(7);
      expect(tenMinutes?.label ?? "").toMatch(/[7-9]割/);
      // 待つ結論と、待ったほうが早く着く見込みの向きがそろう
      await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
        "data-action",
        "wait",
      );
      const waitFaster = page.getByTestId(testIds.judgment.resumeChanceWaitFaster);
      expect(Number(await waitFaster.getAttribute("data-tenths"))).toBeGreaterThanOrEqual(9);
      await expect(page.getByTestId(testIds.judgment.resumeChanceLead)).toContainText(
        "見込みで動いています",
      );
      await waitForMapReady(page);
      await page.screenshot({ path: `${screenshotDir}resume-chance-in-car-${theme}-390x844.png` });
    });
  });
}

// 入口から判断を始める。京橋の大阪環状線で、非常ボタン・急病を選ぶ
async function startFromEntry(page: Page, elapsed: "m10" | "unknown"): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.originSearch).fill("京橋");
  await page.getByTestId(testIds.start.originOption("京橋")).click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "station");
  await page.locator("[data-testid^='start-line-京橋|jr-west.大阪環状線']").first().click();
  await page.locator("[data-testid^='start-direction-']").first().click();
  await page.getByTestId(testIds.start.destinationUndecided).click();
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.cause("inCar")).click();
  await page.getByTestId(testIds.start.elapsed(elapsed)).click();
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
}

test("入口から判断しても帯が出て、止まってからの時間を答えたときだけ「発生から」が付く", async ({
  page,
}) => {
  await startFromEntry(page, "m10");
  const band = page.getByTestId(testIds.judgment.resumeChance);
  await expect(band).toBeVisible();
  await expect(band).toHaveAttribute("data-onset", "known");
  const lead = page.getByTestId(testIds.judgment.resumeChanceLead);
  await expect(lead).toContainText("発生から");
  await expect(lead).toContainText("見込みで動いています");
  await expect(page.getByTestId(testIds.judgment.resumeChanceWaitFaster)).toBeVisible();
  // 10 分前に止まったので、最初の目盛りの発生からの分は 10 分より後
  const ticks = await readTicks(page);
  expect(ticks.length).toBeGreaterThanOrEqual(4);
  expect(ticks[0]?.sinceOnset ?? 0).toBeGreaterThan(10);

  await startFromEntry(page, "unknown");
  await expect(band).toBeVisible();
  await expect(band).toHaveAttribute("data-onset", "unknown");
  await expect(lead).not.toContainText("発生から");
  await expect(lead).toContainText("見込みで動いています");
});

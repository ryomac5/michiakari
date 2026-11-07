import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  loadReplayScenarios,
  openReplay,
  waitForFiniteAnimations,
  waitForJudged,
} from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// スマホの地図は線と円を小さくし、押せる範囲は変えない。撮った画像は e2e/screenshots/mobile-scale/ に出る
// 直す前の画像は SCALE_LABEL=before で撮り直す

const screenshotDir = fileURLToPath(new URL("../screenshots/mobile-scale/", import.meta.url));
const label = process.env.SCALE_LABEL ?? "after";

test.setTimeout(120_000);

async function capture(page: Page, name: string): Promise<void> {
  await waitForFiniteAnimations(page);
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: `${screenshotDir}${label}-${name}.png` });
}

async function openEntry(page: Page): Promise<void> {
  await page.goto("/?mock=1");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
}

async function readHitSizes(page: Page): Promise<number[]> {
  const sizes = await page
    .locator("[data-hit-area]")
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
  return sizes.sort((a, b) => a - b);
}

test.describe("スマホ幅", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("入口の印は小さくなり、押せる範囲は変わらない", async ({ page }) => {
    await openEntry(page);
    await capture(page, "1-entry");
    const hub = page.getByTestId(testIds.start.hub("umeda"));
    const hubHit = hub.locator("[data-hit-area]");
    expect(Math.round((await hubHit.boundingBox())?.width ?? 0)).toBe(26);
    const hubDot = hub.locator(".map-mark");
    if (label === "after") {
      expect(await hubDot.evaluate((el) => getComputedStyle(el).scale)).toBe("0.8");
      expect(Math.round((await hubDot.boundingBox())?.width ?? 0)).toBe(21);
    }

    await hub.click();
    await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "area");
    await expect(page.getByTestId(testIds.start.place("osaka"))).toBeVisible();
    await waitForFiniteAnimations(page);
    await capture(page, "2-area");
    const sizes = await readHitSizes(page);
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(24);
    const place = page.getByTestId(testIds.start.place("osaka"));
    expect(Math.round((await place.locator("[data-hit-area]").boundingBox())?.width ?? 0)).toBe(
      Math.max(...sizes.filter((s) => s <= 28)),
    );
  });

  test("判断の画面の地図も撮る", async ({ page }) => {
    const scenario = loadReplayScenarios()[0];
    if (!scenario) throw new Error("シナリオが無い");
    await openReplay(page, scenario.id);
    const first = scenario.timeline[0];
    if (!first) throw new Error("観測が無い");
    await page.getByTestId(testIds.replay.nextButton).click();
    await waitForJudged(page, first.id);
    await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    await capture(page, "3-judgment");
  });
});

test.describe("パソコン幅", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("印の倍率は 1 のまま", async ({ page }) => {
    await openEntry(page);
    const hubDot = page.getByTestId(testIds.start.hub("umeda")).locator(".map-mark");
    expect(await hubDot.evaluate((el) => getComputedStyle(el).scale)).toMatch(/^(none|1)$/);
  });
});

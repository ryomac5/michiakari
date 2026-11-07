/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { checkWeatherIncident, findIncidentType } from "../../packages/core/src/index.ts";
import {
  findRepoRoot,
  loadScenarioDir,
  resolveContentDir,
} from "../../packages/schema/src/loaders.ts";
import type { Scenario } from "../../packages/schema/src/scenario.ts";
import { contentDir } from "../servers.ts";

// リプレイのテストと録画で共有する部品

// agent と web に渡すのと同じ CONTENT_DIR のシナリオを読む。読めないファイルがあれば止める
export function loadReplayScenarios(): Scenario[] {
  const root = resolveContentDir({ CONTENT_DIR: contentDir }, findRepoRoot());
  const result = loadScenarioDir(join(root, "scenarios"));
  if (result.errors.length > 0) {
    throw new Error(`シナリオを読めません: ${result.errors.map((e) => e.message).join(" / ")}`);
  }
  return result.entries.map((entry) => entry.data);
}

// シナリオの種類が天気の事象かで、気象を判断に使うシナリオとそれ以外に分ける
export function splitScenariosByWeather(scenarios: readonly Scenario[]): {
  weather: Scenario[];
  other: Scenario[];
} {
  const usesWeather = (s: Scenario) => checkWeatherIncident(findIncidentType(s.event_type));
  return {
    weather: scenarios.filter(usesWeather),
    other: scenarios.filter((s) => !usesWeather(s)),
  };
}

export async function openReplay(page: Page, scenarioId: string, speed?: number): Promise<void> {
  const query = new URLSearchParams({ scenario: scenarioId });
  if (speed !== undefined) query.set("speed", String(speed));
  await page.goto(`/replay?${query}`);
  await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "idle", {
    timeout: 60_000,
  });
}

// 指定した観測の判断が確定し、結論が表示されるまで待つ
export async function waitForJudged(
  page: Page,
  observationId: string,
  timeout = 30_000,
): Promise<void> {
  const judgment = page.getByTestId(testIds.replay.judgment);
  await expect(judgment).toHaveAttribute("data-observation-id", observationId, { timeout });
  await expect(judgment).toHaveAttribute("data-status", "ready");
  await expect(page.getByTestId(testIds.replay.screen)).not.toHaveAttribute(
    "data-state",
    "judging",
  );
  // 最後まで流れて結末を出したら、畳んだ最後の判断を開き直す
  const reopen = page.getByTestId(testIds.replay.lastJudgmentToggle);
  if ((await reopen.count()) > 0 && (await reopen.getAttribute("aria-expanded")) === "false") {
    await reopen.click();
  }
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible();
}

// 地図の上のシートを指定の段まで開く。取っ手を上下キーで操作する。PC 幅では取っ手が無いので何もしない
export type SheetSnap = "collapsed" | "half" | "full";
const sheetSnaps: SheetSnap[] = ["collapsed", "half", "full"];

export async function openSheet(page: Page, snap: SheetSnap): Promise<void> {
  const sheet = page.getByTestId(testIds.judgment.sheet);
  const handle = page.getByTestId(testIds.judgment.sheetHandle);
  if (!(await handle.isVisible())) return;
  for (let i = 0; i < sheetSnaps.length; i++) {
    const current = (await sheet.getAttribute("data-snap")) as SheetSnap;
    if (current === snap) break;
    const up = sheetSnaps.indexOf(snap) > sheetSnaps.indexOf(current);
    await handle.press(up ? "ArrowUp" : "ArrowDown");
  }
  await expect(sheet).toHaveAttribute("data-snap", snap);
  await waitForFiniteAnimations(page);
}

// 表示の切り替えアニメーションが終わるのを待つ。回り続けるものは対象外
// 待つ間に要素が消えて取り消されたアニメーションは、終わったものとして扱う
export async function waitForFiniteAnimations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

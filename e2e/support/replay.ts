/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
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
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible();
}

// 表示の切り替えアニメーションが終わるのを待つ。回り続けるものは対象外
export async function waitForFiniteAnimations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY)
        .map((a) => a.finished),
    ),
  );
}

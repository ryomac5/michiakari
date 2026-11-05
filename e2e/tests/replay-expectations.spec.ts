/// <reference lib="dom" />
// page 内で動かす関数（addInitScript・evaluate）のために DOM の型を読む
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import ja from "../../apps/web/messages/ja.json" with { type: "json" };
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import type { Expectation, Scenario } from "../../packages/schema/src/scenario.ts";
import {
  loadReplayScenarios,
  openReplay,
  openSheet,
  waitForFiniteAnimations,
  waitForJudged,
} from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// シナリオの振る舞いテスト（architecture.md 7.2）
// CONTENT_DIR のすべてのシナリオをリプレイで流し、YAML の expectations を画面の DOM で確かめる
// シナリオ ID と期待値はコードに書かず、YAML から生成する

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));
// テスト用の再生速度。シナリオの 60 分を実時間 1 秒で進める
const testSpeed = 60;
const scenarios = loadReplayScenarios();
// 利用者に「分からない」と返す言い回し。結論と理由には出さない
const nonDecisive =
  /まだ判断できません|判断できません|分かりません|わかりません|情報が足りません|材料が不足|見込みが立ちません|unknown|can't|not enough information/i;

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(180_000);

test("CONTENT_DIR にシナリオがあり、一覧から選べる", async ({ page }) => {
  expect(scenarios.length).toBeGreaterThan(0);
  await page.goto("/replay");
  for (const scenario of scenarios) {
    await expect(page.getByTestId(testIds.replay.scenario(scenario.id))).toBeVisible({
      timeout: 60_000,
    });
  }
  const [first] = scenarios;
  if (!first) return;
  await page.getByTestId(testIds.replay.scenario(first.id)).click();
  await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute(
    "data-scenario-id",
    first.id,
  );
  await expect(page.getByTestId(testIds.replay.progress)).toHaveAttribute(
    "data-total",
    String(first.timeline.length),
  );
});

// 期待する振る舞い 1 件を、いま表示中の判断について確かめる
async function checkExpectation(page: Page, expectation: Expectation): Promise<void> {
  const judgment = page.getByTestId(testIds.replay.judgment);
  const label = `${expectation.after}: ${expectation.note}`;

  if (expectation.action !== undefined) {
    await expect(page.getByTestId(testIds.judgment.conclusion), label).toHaveAttribute(
      "data-action",
      expectation.action,
    );
  }
  if (expectation.phase !== undefined) {
    await expect(judgment, label).toHaveAttribute("data-phase-id", expectation.phase);
    await expect(page.getByTestId(testIds.replay.phase(expectation.phase)), label).toHaveAttribute(
      "data-position",
      "current",
    );
  }
  for (const id of expectation.evidence_includes ?? []) {
    await expect(judgment, label).toHaveAttribute(
      "data-evidence-ids",
      new RegExp(`(^| )${id}( |$)`),
    );
    await expect(page.getByTestId(testIds.judgment.evidenceItem(id)).first(), label).toBeVisible();
  }
  if (expectation.break_even_shown !== undefined) {
    const breakEven = page.getByTestId(testIds.judgment.breakEven);
    const action = await page.getByTestId(testIds.judgment.conclusion).getAttribute("data-action");
    if (expectation.break_even_shown && action === "switch") {
      // 切り替えでは、閉じたシートは残り時間の代わりに切り替え先を出し、分岐点は開いたシートの文に残す
      await expect(breakEven, label).toHaveAttribute("data-state", /^(open|soon|passed)$/);
      await expect(breakEven, label).toHaveAttribute("data-mode", "switch");
      await expect(page.getByTestId(testIds.judgment.switchStep), label).toBeVisible();
      await expect(page.getByTestId(testIds.judgment.breakEvenCountdown), label).toHaveCount(0);
      await expect(
        page.getByTestId(testIds.judgment.breakEvenSentence).locator("time"),
        label,
      ).toHaveText(/^\d{2}:\d{2}$/);
    } else if (expectation.break_even_shown) {
      await expect(breakEven, label).toHaveAttribute("data-state", /^(open|soon|passed)$/);
      await expect(page.getByTestId(testIds.judgment.breakEvenTime), label).toHaveText(
        /^\d{2}:\d{2}$/,
      );
    } else {
      await expect(breakEven, label).toHaveAttribute("data-state", "none");
    }
  }
}

// いまのシートの段のまま撮る
async function captureReplay(page: Page, name: string): Promise<void> {
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}${name}-390x844.png` });
}

// 判断が確定するたびに、表示中の観測 id を記録する
async function recordJudgedObservations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: string[] = [];
    Object.assign(window, { __judgedLog: log });
    new MutationObserver(() => {
      const el = document.querySelector("[data-testid='replay-judgment']");
      const id = el?.getAttribute("data-observation-id") ?? "";
      if (el?.getAttribute("data-status") === "ready" && id !== "" && log.at(-1) !== id) {
        log.push(id);
      }
    }).observe(document, { subtree: true, attributes: true, childList: true });
  });
}

function findExpectations(scenario: Scenario, observationId: string): Expectation[] {
  return scenario.expectations.filter((e) => e.after === observationId);
}

for (const scenario of scenarios) {
  test.describe(`シナリオ ${scenario.id}`, () => {
    test("観測を 1 件ずつ入れると、毎回結論と分岐点が更新され、期待どおりの振る舞いになる", async ({
      page,
    }) => {
      await openReplay(page, scenario.id, testSpeed);
      const bar = page.getByTestId(testIds.replay.bar);
      let previousAction: string | null = null;
      let previousChance = ja.judgment.change.notCalculated;

      for (const [index, entry] of scenario.timeline.entries()) {
        await page.getByTestId(testIds.replay.nextButton).click();
        await waitForJudged(page, entry.id);

        // 新しい発表が表示され、進捗と時刻が進む
        await expect(page.getByTestId(testIds.replay.announcement)).toHaveAttribute(
          "data-observation-id",
          entry.id,
        );
        await expect(page.getByTestId(testIds.replay.progress)).toHaveAttribute(
          "data-entered",
          String(index + 1),
        );
        await expect(page.getByTestId(testIds.replay.clock)).toHaveText(/\d{2}:\d{2}$/);

        // 結論と分岐点が、この観測の判断で描き直されている
        await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
          "data-action",
          /^(wait|switch|hold)$/,
        );
        await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).not.toBeEmpty();
        const currentAction = await page
          .getByTestId(testIds.judgment.conclusion)
          .getAttribute("data-action");
        const change = page.getByTestId(testIds.judgment.change);
        const chance = page.getByTestId(testIds.judgment.resumeChanceWaitFaster);
        const currentChance =
          (await chance.count()) > 0
            ? ((await chance.locator("dd").textContent())?.trim() ?? "")
            : ja.judgment.change.notCalculated;
        if (previousAction !== null && previousAction !== currentAction) {
          await expect(change).toHaveAttribute("data-from", previousAction);
          await expect(change).toHaveAttribute("data-to", currentAction ?? "");
          await expect(page.getByTestId(testIds.judgment.changeProbability)).toHaveText(
            `${previousChance} → ${currentChance}`,
          );
        } else {
          await expect(change).toHaveCount(0);
        }
        previousAction = currentAction;
        previousChance = currentChance;
        // どの段でも、結論と理由は行動の言葉で言い切る
        await expect(page.getByTestId(testIds.judgment.conclusion)).not.toContainText(nonDecisive);
        const reason = page.getByTestId(testIds.judgment.conclusionReason);
        if ((await reason.count()) > 0) await expect(reason).not.toContainText(nonDecisive);
        const breakEvenFrame = page.locator(`[data-observation-id="${entry.id}"]`, {
          has: page.getByTestId(testIds.judgment.breakEven),
        });
        await expect(breakEvenFrame).toBeVisible();
        await expect(page.getByTestId(testIds.judgment.breakEven)).toHaveAttribute(
          "data-state",
          /^(open|soon|passed|none)$/,
        );
        await expect(page.getByTestId(testIds.judgment.breakEven)).toHaveAttribute(
          "data-stale",
          "false",
        );
        await expect(page.getByTestId(testIds.replay.historyItem(entry.id))).toHaveAttribute(
          "data-action",
          /^(wait|switch|hold)$/,
        );

        // 根拠は既定で閉じているので、最初の判断の後にシートを全部開いてから根拠を開いておく
        if (index === 0) {
          await openSheet(page, "full");
          await page.getByTestId(testIds.judgment.evidenceToggle).click();
        }

        for (const expectation of findExpectations(scenario, entry.id)) {
          await checkExpectation(page, expectation);
          if (expectation.action === "switch") {
            await captureReplay(page, `replay-${scenario.id}-${entry.id}`);
          }
        }
      }

      await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "ended");
      await expect(bar).toHaveAttribute("data-state", "ended");
      await captureReplay(page, `replay-${scenario.id}-end`);
    });

    test(`再生すると ${testSpeed}x で最後まで流れ、観測ごとに判断が確定して履歴に残る`, async ({
      page,
    }) => {
      await recordJudgedObservations(page);
      await openReplay(page, scenario.id, testSpeed);
      await expect(page.getByTestId(testIds.replay.speed(testSpeed))).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await page.getByTestId(testIds.replay.playButton).click();
      await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "ended", {
        timeout: 120_000,
      });

      // 各観測の判断が順に画面へ出ている
      const log = await page.evaluate(
        () => (window as unknown as { __judgedLog: string[] }).__judgedLog,
      );
      expect(log).toEqual(scenario.timeline.map((entry) => entry.id));

      for (const expectation of scenario.expectations) {
        const item = page.getByTestId(testIds.replay.historyItem(expectation.after));
        const label = `${expectation.after}: ${expectation.note}`;
        if (expectation.action !== undefined) {
          await expect(item, label).toHaveAttribute("data-action", expectation.action);
        }
        if (expectation.phase !== undefined) {
          await expect(item, label).toHaveAttribute("data-phase-id", expectation.phase);
        }
        for (const id of expectation.evidence_includes ?? []) {
          await expect(item, label).toHaveAttribute(
            "data-evidence-ids",
            new RegExp(`(^| )${id}( |$)`),
          );
        }
        if (expectation.break_even_shown !== undefined) {
          await expect(item, label).toHaveAttribute(
            "data-break-even-shown",
            String(expectation.break_even_shown),
          );
        }
      }
    });
  });
}

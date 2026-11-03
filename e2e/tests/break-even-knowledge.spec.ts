/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  loadReplayScenarios,
  openReplay,
  openSheet,
  waitForFiniteAnimations,
  waitForJudged,
} from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 分岐点の時間軸と、知見ナレッジの閲覧画面の振る舞い
// シナリオ ID と期待値はコードに書かず、YAML から選ぶ

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));
const scenarios = loadReplayScenarios();
// 主役のシナリオ: 期待値に switch を含む最初のもの
const scenario = scenarios.find((s) => s.expectations.some((e) => e.action === "switch"));
const switchIndex = scenario?.expectations.findIndex((e) => e.action === "switch") ?? -1;
const switchExpectation = scenario?.expectations[switchIndex];
// switch の直前にある wait の期待値
const waitExpectation = scenario?.expectations
  .slice(0, Math.max(switchIndex, 0))
  .findLast((e) => e.action === "wait");

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(180_000);

async function captureTop(page: Page, name: string): Promise<void> {
  await waitForFiniteAnimations(page);
  await page.screenshot({ path: `${screenshotDir}${name}-390x844.png` });
}

// 指定した観測まで 1 件ずつ進める
async function stepUntil(page: Page, observationId: string): Promise<void> {
  if (!scenario) throw new Error("シナリオがありません");
  const shown = await page.getByTestId(testIds.replay.judgment).getAttribute("data-observation-id");
  const start = scenario.timeline.findIndex((e) => e.id === shown) + 1;
  for (const entry of scenario.timeline.slice(start)) {
    await page.getByTestId(testIds.replay.nextButton).click();
    await waitForJudged(page, entry.id);
    if (entry.id === observationId) return;
  }
  throw new Error(`観測 ${observationId} まで進めませんでした`);
}

test("待つ判断では再開見込みが分岐点より前、切り替える判断では後に描かれる", async ({ page }) => {
  if (!scenario || !switchExpectation || !waitExpectation) {
    throw new Error("wait のあとに switch へ変わるシナリオがありません");
  }
  await openReplay(page, scenario.id);
  const timeline = page.getByTestId(testIds.judgment.breakEvenTimeline);
  const conclusion = page.getByTestId(testIds.judgment.conclusion);

  await stepUntil(page, waitExpectation.after);
  await expect(conclusion).toHaveAttribute("data-action", "wait");
  // 閉じたシートでは再開見込みを 1 行で示し、半分開くと時間軸の全体が見える
  await expect(page.getByTestId(testIds.judgment.breakEvenResume)).toHaveAttribute(
    "data-relation",
    "before",
  );
  await openSheet(page, "half");
  await expect(timeline).toBeInViewport();
  await expect(timeline).toHaveAttribute("data-relation", "before");
  await captureTop(page, `timeline-${waitExpectation.after}`);

  await stepUntil(page, switchExpectation.after);
  await expect(conclusion).toHaveAttribute("data-action", "switch");
  await expect(timeline).toHaveAttribute("data-relation", "after");
  // 図の値は判断の分岐点と一致し、帯の始まりは分岐点より後にある
  const breakEvenTime = await page
    .getByTestId(testIds.judgment.breakEvenTime)
    .evaluate((el) => el.getAttribute("datetime"));
  await expect(timeline).toHaveAttribute("data-break-even", breakEvenTime ?? "");
  const [breakEven, resumeP50] = await timeline.evaluate((el) => [
    Date.parse(el.getAttribute("data-break-even") ?? ""),
    Date.parse(el.getAttribute("data-resume-p50") ?? ""),
  ]);
  expect(resumeP50).toBeGreaterThan(breakEven ?? Number.POSITIVE_INFINITY);
  await captureTop(page, `timeline-${switchExpectation.after}`);
});

test("根拠の兆候から知見の該当箇所へ飛び、そこからリプレイへ戻れる", async ({ page }) => {
  if (!scenario || !switchExpectation) throw new Error("シナリオがありません");
  const signalId = switchExpectation.evidence_includes?.[0];
  if (!signalId) throw new Error("switch の期待値に evidence_includes がありません");

  await openReplay(page, scenario.id);
  await stepUntil(page, switchExpectation.after);
  await openSheet(page, "full");
  await page.getByTestId(testIds.judgment.evidenceToggle).click();
  const link = page.getByTestId(testIds.judgment.signalLink(signalId));
  await expect(link).toHaveAttribute("href", `/knowledge#signal-${signalId}`);
  await link.click();

  await expect(page).toHaveURL(new RegExp(`/knowledge#signal-${signalId}$`));
  await expect(page.getByTestId(testIds.knowledge.screen)).toBeVisible();
  await expect(page.getByTestId(testIds.knowledge.notice)).toContainText("社内情報は含みません");
  // e2e は開発用のダミーを読むので、その旨が出る
  await expect(page.getByTestId(testIds.knowledge.dummyNotice)).toBeVisible();
  const signal = page.getByTestId(testIds.knowledge.signal(signalId));
  await expect(signal).toHaveAttribute("id", `signal-${signalId}`);
  await expect(signal).toBeInViewport();

  const event = page.getByTestId(testIds.knowledge.event(scenario.event_type));
  await expect(event.getByTestId(testIds.knowledge.caveats(scenario.event_type))).toBeAttached();
  await event.getByTestId(testIds.knowledge.replayLink(scenario.id)).click();
  await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute(
    "data-scenario-id",
    scenario.id,
    { timeout: 60_000 },
  );
});

test("知見の閲覧画面に、段階・兆候・次の段階へのつながりが出る", async ({ page }) => {
  if (!scenario) throw new Error("シナリオがありません");
  await page.goto("/");
  await page.getByTestId(testIds.app.menuButton).click();
  await page.getByTestId(testIds.app.knowledgeLink).click();
  const event = page.getByTestId(testIds.knowledge.event(scenario.event_type));
  await expect(event).toBeVisible({ timeout: 60_000 });
  await expect(event).toHaveAttribute("data-dummy", "true");

  // 期待値に出てくる兆候は、すべてこの画面にアンカー付きで載っている
  const signalIds = scenario.expectations.flatMap((e) => e.evidence_includes ?? []);
  for (const id of new Set(signalIds)) {
    await expect(page.locator(`#signal-${id}`)).toHaveCount(1);
  }
  // 次の段階へのリンクは、同じ画面の兆候を指している
  const exitLinks = event.locator("a[href^='#signal-']");
  expect(await exitLinks.count()).toBeGreaterThan(0);
  for (const href of await exitLinks.evaluateAll((els) => els.map((a) => a.getAttribute("href")))) {
    await expect(page.locator(href ?? "#missing")).toHaveCount(1);
  }
});

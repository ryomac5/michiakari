/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import en from "../../apps/web/messages/en.json" with { type: "json" };
import ja from "../../apps/web/messages/ja.json" with { type: "json" };
import { testIds } from "../../apps/web/src/lib/testids.ts";
import {
  loadReplayScenarios,
  openReplay,
  openSheet,
  waitForFiniteAnimations,
  waitForJudged,
} from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 閉じたシートの上部の表示。切り替えでは残り時間の代わりに切り替え先の行動を出し、待つときは残り時間を保つ
// 理由の文の時刻と「1時間」のような数と単位は、途中で改行しない
// シナリオ ID はコードに書かず、YAML から「切り替えで始まり、あとで待つに変わる」ものを選ぶ

type Variant = { name: string; locale: "ja" | "en"; width: number; height: number };
const variants: Variant[] = [
  { name: "ja-light-390", locale: "ja", width: 390, height: 844 },
  { name: "ja-light-1280", locale: "ja", width: 1280, height: 800 },
  { name: "en-light-390", locale: "en", width: 390, height: 844 },
];

const screenshotRoot = fileURLToPath(new URL("../screenshots/switch-step/", import.meta.url));
const scenario = loadReplayScenarios().find(
  (s) =>
    s.expectations[0]?.action === "switch" &&
    s.expectations.some((e) => e.action === "wait") &&
    s.expectations.some((e) => e.break_even_shown),
);
const switchAfter = scenario?.expectations[0]?.after;
const waitAfter = scenario?.expectations.find((e) => e.action === "wait")?.after;
// 残り時間の言い回し。ja は「あと 36 分」、en は「36 min left」
const countdownText = /あと ?\d+ ?(分|時間)|\d+ min left|\d+ h \d+ min left/;

test.setTimeout(180_000);

async function capture(page: Page, variant: Variant, name: string): Promise<void> {
  await waitForFiniteAnimations(page);
  const dir = `${screenshotRoot}${variant.name}/`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}${name}.png` });
}

test.describe("通常画面の判断の変化", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("情報を追加すると前の待つ判断と今の切り替え判断を並べる", async ({ page }) => {
    await page.goto("/?mock=1");
    await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
      timeout: 30_000,
    });
    await page.getByTestId(testIds.start.positionStation).click();
    await page.getByTestId(testIds.start.originSearch).fill("大阪");
    await page.getByTestId(testIds.start.originOption("大阪")).click();

    await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
    await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
    await page.getByTestId(testIds.start.method("paste")).click();
    await page.getByTestId(testIds.situation.pasteInput).fill("人身事故で運転を見合わせています。");
    await page.getByTestId(testIds.situation.submit("paste")).click();
    await expect(page.getByTestId(testIds.judgment.screen)).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/judgment$/);
    const conclusion = page.getByTestId(testIds.judgment.conclusion);
    await expect(conclusion).toHaveAttribute("data-action", "wait", { timeout: 30_000 });
    await expect(page.getByTestId(testIds.judgment.change)).toHaveCount(0);

    await openSheet(page, "full");
    const addInfo = page.getByTestId(testIds.judgment.addInfo);
    await addInfo.getByTestId(testIds.situation.tab("paste")).click();
    await addInfo.getByTestId(testIds.situation.pasteInput).fill("振替輸送を実施しています。");
    await addInfo.getByTestId(testIds.situation.submit("paste")).click();
    await expect(conclusion).toHaveAttribute("data-action", "switch", { timeout: 30_000 });
    await openSheet(page, "collapsed");
    const change = page.getByTestId(testIds.judgment.change);
    await expect(change).toHaveAttribute("data-from", "wait");
    await expect(change).toHaveAttribute("data-to", "switch");
    await expect(page.getByTestId(testIds.judgment.changeBefore)).toContainText(
      ja.judgment.action.wait,
    );
    await expect(page.getByTestId(testIds.judgment.changeAfter)).toContainText(
      ja.judgment.action.switch,
    );
    await expect(change).toContainText("振替輸送を実施しています。");
    // 確率が無ければ行ごと出さず、「未算出」は出さない
    await expect(change).not.toContainText("未算出");
    await expect(page.getByTestId(testIds.judgment.changeProbability)).toHaveCount(0);
    await expect(page.getByTestId(testIds.judgment.changeReading)).toContainText(
      ja.judgment.evidence.reading.label,
    );
    expect(
      await conclusion.evaluate((element) =>
        element.nextElementSibling?.getAttribute("data-testid"),
      ),
    ).toBe(testIds.judgment.change);
    await waitForFiniteAnimations(page);
    for (const locator of [conclusion, change, page.getByTestId(testIds.judgment.disclaimer)]) {
      await expect(locator).toBeInViewport({ ratio: 1 });
    }
  });
});

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

// 折り返しを止めた範囲が、どれも 1 行に収まっていること
async function expectUnbrokenRuns(page: Page, label: string): Promise<void> {
  const reason = page.getByTestId(testIds.judgment.conclusionReason);
  if ((await reason.count()) === 0) return;
  const broken = await reason.evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>("span.whitespace-nowrap")]
      .filter((span) => span.getClientRects().length > 1)
      .map((span) => span.textContent ?? ""),
  );
  expect(broken, `${label}: 時刻や数と単位の途中で改行している`).toEqual([]);
  const layout = await reason.evaluate((el) => {
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
    return { height: el.clientHeight, fullHeight: el.scrollHeight, lineHeight };
  });
  expect(layout.fullHeight, `${label}: 理由が3行を超えている`).toBeLessThanOrEqual(
    Math.ceil(layout.lineHeight * 3),
  );
  expect(layout.fullHeight, `${label}: 理由が途中で切れている`).toBeLessThanOrEqual(
    layout.height + 1,
  );
}

for (const variant of variants) {
  test.describe(`シートの上部 ${variant.name}`, () => {
    test.use({ viewport: { width: variant.width, height: variant.height }, deviceScaleFactor: 2 });

    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([
        { name: "NEXT_LOCALE", value: variant.locale, url: baseURL ?? "" },
        { name: "theme", value: "light", url: baseURL ?? "" },
      ]);
    });

    test("切り替えでは残り時間の代わりに切り替え先を出し、待つときは残り時間を出す", async ({
      page,
    }) => {
      if (!scenario || !switchAfter || !waitAfter) {
        throw new Error("切り替えで始まり、待つに変わるシナリオがありません");
      }
      await openReplay(page, scenario.id);
      const conclusion = page.getByTestId(testIds.judgment.conclusion);
      const breakEven = page.getByTestId(testIds.judgment.breakEven);
      const step = page.getByTestId(testIds.judgment.switchStep);
      const change = page.getByTestId(testIds.judgment.change);

      await stepUntil(page, switchAfter);
      await expect(conclusion).toHaveAttribute("data-action", "switch");
      await expect(change).toHaveCount(0);
      await expect(breakEven).toHaveAttribute("data-mode", "switch");
      await expect(page.getByTestId(testIds.judgment.breakEvenCountdown)).toHaveCount(0);
      for (const locator of [conclusion, breakEven]) {
        await expect(locator).not.toContainText(countdownText);
      }
      await expect(step).toBeVisible();
      await expect(step).toContainText(
        variant.locale === "ja" ? /\d{2}:\d{2}着/ : /Arrive \d{2}:\d{2}/,
      );
      // 乗る駅まで歩くなら徒歩の分数、その駅で乗るなら駅名を出す
      await expect(step).toContainText(
        variant.locale === "ja" ? /まで徒歩\d+分|から乗る|タクシー|徒歩/ : /Walk|Board at|taxi/,
      );
      // 切り替え先の到着は、推奨の選択肢の到着と同じ
      const optionId = await step.getAttribute("data-option-id");
      const arrival = await page
        .getByTestId(testIds.judgment.option(optionId ?? ""))
        .locator("p.tabular-nums")
        .first()
        .textContent();
      await expect(step).toContainText((arrival ?? "").replace(/^\D*/, "").trim());
      await expect(page.getByTestId(testIds.judgment.disclaimer)).toBeVisible();
      await expectUnbrokenRuns(page, `${variant.name} ${switchAfter}`);
      await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
        timeout: 30_000,
      });
      await capture(page, variant, `${scenario.id}-${switchAfter}-switch`);

      await stepUntil(page, waitAfter);
      await expect(conclusion).toHaveAttribute("data-action", "wait");
      const waitIndex = scenario.timeline.findIndex((entry) => entry.id === waitAfter);
      const previousEntry = scenario.timeline[waitIndex - 1];
      const previousAction = scenario.expectations.find(
        (e) => e.after === previousEntry?.id,
      )?.action;
      if (!previousAction) throw new Error("前回の判断の期待値がありません");
      const messages = variant.locale === "ja" ? ja : en;
      await expect(change).toBeVisible();
      expect(
        await conclusion.evaluate((element) =>
          element.nextElementSibling?.getAttribute("data-testid"),
        ),
      ).toBe(testIds.judgment.change);
      await expect(change).toHaveAttribute("data-from", previousAction);
      await expect(change).toHaveAttribute("data-to", "wait");
      await expect(page.getByTestId(testIds.judgment.changeBefore)).toContainText(
        messages.judgment.action[previousAction],
      );
      await expect(page.getByTestId(testIds.judgment.changeAfter)).toContainText(
        messages.judgment.action.wait,
      );
      await expect(page.getByTestId(testIds.judgment.changeAnnouncement)).not.toBeEmpty();
      await expect(change).toContainText(messages.judgment.change.probability);
      await expect(page.getByTestId(testIds.judgment.disclaimer)).toBeVisible();
      await expect(breakEven).toHaveAttribute("data-mode", "break-even");
      await expect(step).toHaveCount(0);
      await expect(page.getByTestId(testIds.judgment.breakEvenCountdown)).toHaveText(countdownText);
      await expectUnbrokenRuns(page, `${variant.name} ${waitAfter}`);
      await capture(page, variant, `${scenario.id}-${waitAfter}-wait`);
      // 結論・変化のカード・注意書きが同じ画面に入り、前から後の順で並ぶ
      for (const locator of [conclusion, change, page.getByTestId(testIds.judgment.disclaimer)]) {
        await expect(locator).toBeInViewport({ ratio: 1 });
      }
      const beforeBox = await page.getByTestId(testIds.judgment.changeBefore).boundingBox();
      const afterBox = await page.getByTestId(testIds.judgment.changeAfter).boundingBox();
      expect(beforeBox?.x).toBeLessThan(afterBox?.x ?? 0);
    });
  });
}

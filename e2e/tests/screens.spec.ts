/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import en from "../../apps/web/messages/en.json" with { type: "json" };
import jaMessages from "../../apps/web/messages/ja.json" with { type: "json" };
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  loadReplayKnowledge,
  loadReplayScenarios,
  openSheet,
  splitScenariosByWeather,
  waitForFiniteAnimations,
  waitForJudged,
} from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 全画面を言語・テーマ・画面幅の組み合わせで撮り、見た目の約束を機械で確かめる
// 撮った画像は e2e/screenshots/screens/<組み合わせ>/ に出る（git 管理外）

type Variant = {
  name: string;
  locale: "ja" | "en";
  theme: "dark" | "light";
  width: number;
  height: number;
};

const mobile = { width: 390, height: 844 };
const desktop = { width: 1280, height: 800 };
const variants: Variant[] = [
  { name: "ja-dark-390", locale: "ja", theme: "dark", ...mobile },
  { name: "ja-light-390", locale: "ja", theme: "light", ...mobile },
  { name: "en-dark-390", locale: "en", theme: "dark", ...mobile },
  { name: "en-light-390", locale: "en", theme: "light", ...mobile },
  { name: "ja-dark-1280", locale: "ja", theme: "dark", ...desktop },
  { name: "en-light-1280", locale: "en", theme: "light", ...desktop },
];

const screenshotRoot = fileURLToPath(new URL("../screenshots/screens/", import.meta.url));
// 結論が切り替えに変わるシナリオを優先して撮る。その観測まで進め、無ければ最後の観測で撮る
const scenarios = loadReplayScenarios();
const scenario =
  scenarios.find((s) => s.expectations.some((e) => e.action === "switch")) ?? scenarios[0];
const switchAfter =
  scenario?.expectations.find((e) => e.action === "switch")?.after ?? scenario?.timeline.at(-1)?.id;
// 気象を使う事象のシナリオは、知見の external_factors.weather で選ぶ。待つ判断になった観測で撮る
const weatherScenario = splitScenariosByWeather(scenarios, loadReplayKnowledge()).weather[0];
const weatherWaitAfter =
  weatherScenario?.expectations.find((e) => e.action === "wait")?.after ??
  weatherScenario?.timeline.at(-1)?.id;

// 入口の段が増え、撮る場面も増えたので、全体を並べて走らせたときの余裕を見て長めにする
test.setTimeout(240_000);

async function capture(page: Page, variant: Variant, name: string, fullPage = false) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForFiniteAnimations(page);
  const dir = `${screenshotRoot}${variant.name}/`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}${name}.png`, fullPage });
}

// 横にはみ出す要素が無いこと
async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflowing = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= width) return [];
    // はみ出している末端の要素を挙げて、直す場所が分かるようにする
    return [...document.body.querySelectorAll<HTMLElement>("*")]
      .filter((el) => el.getBoundingClientRect().right > width + 0.5 && el.children.length === 0)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)}`)
      .slice(0, 5);
  });
  expect(overflowing, `${label}: 横スクロールが出ている`).toEqual([]);
}

// 見えている操作部品の高さが 44px 以上であること
async function expectTapTargets(page: Page, label: string) {
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "a[href], button, input:not([type=hidden]):not(.sr-only), textarea, [role=option], [role=tab]",
      ),
    ]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        // 見えない読み上げ専用の部品（sr-only の 1px）は除く
        return rect.width > 1 && rect.height > 1 && style.visibility !== "hidden";
      })
      .filter((el) => el.getBoundingClientRect().height < 44)
      .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}"`),
  );
  expect(small, `${label}: 44px 未満の操作部品`).toEqual([]);
}

async function checkScreen(page: Page, label: string) {
  await expectNoHorizontalScroll(page, label);
  await expectTapTargets(page, label);
}

// スマートフォンの閉じたシートに、結論の種類・見出し・分岐点（時間軸を含む）・注意書きが見えていること
async function expectFirstViewport(page: Page, variant: Variant, label: string) {
  await expect(page.getByTestId(testIds.judgment.sheet), label).toHaveAttribute(
    "data-snap",
    "collapsed",
  );
  await waitForFiniteAnimations(page);
  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  const breakEven = page.getByTestId(testIds.judgment.breakEven);
  const resume = page.getByTestId(testIds.judgment.breakEvenResume);
  const disclaimer = page.getByTestId(testIds.judgment.disclaimer);
  for (const [name, locator] of [
    ["結論", conclusion],
    ["分岐点", breakEven],
    ["再開見込み", resume],
    ["注意書き", disclaimer],
  ] as const) {
    const box = await locator.boundingBox();
    expect(box, `${label}: ${name}が見つからない`).not.toBeNull();
    expect(box?.y ?? -1, `${label}: ${name}が画面の上にはみ出している`).toBeGreaterThanOrEqual(0);
    expect(
      (box?.y ?? 0) + (box?.height ?? 0),
      `${label}: ${name}が閉じたシートに収まらない`,
    ).toBeLessThanOrEqual(variant.height);
  }
  await expect(conclusion, label).toHaveAttribute("data-action", /^(wait|switch|hold)$/);
  const lines = await page
    .getByTestId(testIds.judgment.conclusionHeadline)
    .evaluate((el) =>
      Math.round(el.scrollHeight / Number.parseFloat(getComputedStyle(el).lineHeight)),
    );
  expect(lines, `${label}: 見出しが 4 行を超えている`).toBeLessThanOrEqual(4);
}

for (const variant of variants) {
  test.describe(`画面 ${variant.name}`, () => {
    test.use({ viewport: { width: variant.width, height: variant.height }, deviceScaleFactor: 2 });

    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([
        { name: "NEXT_LOCALE", value: variant.locale, url: baseURL ?? "" },
        { name: "theme", value: variant.theme, url: baseURL ?? "" },
      ]);
    });

    test("開始・状況・判断・このアプリについて", async ({ page }) => {
      const ja = variant.locale === "ja";
      await page.goto("/?mock=1");
      await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
        timeout: 30_000,
      });
      await expect(page.locator("html")).toHaveClass(variant.theme);
      await expect(page.getByTestId(testIds.app.homeLink)).toContainText(
        ja ? "みちあかり" : "Michiakari",
      );
      await expect(page).toHaveTitle(ja ? /みちあかり/ : /Michiakari/);
      await expect(page.getByTestId(testIds.start.positionStation)).toBeVisible();
      await expect(page.getByTestId(testIds.start.positionTrain)).toBeVisible();
      await capture(page, variant, "00-start-location");
      await checkScreen(page, "開始（いまどこ）");
      await page.getByTestId(testIds.start.positionStation).click();
      await expect(page.getByTestId(testIds.start.hub("umeda"))).toBeVisible();
      const messages = ja ? jaMessages : en;
      await waitForFiniteAnimations(page);
      for (const [id, text] of [
        [testIds.start.introAudience, messages.start.introAudience],
        [testIds.start.introProblem, messages.start.introProblem],
        [testIds.start.introSolution, messages.start.introSolution],
      ] as const) {
        await expect(page.getByTestId(id)).toHaveText(text);
        await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
      }
      await expect(page.getByTestId(testIds.start.originSearch)).toBeInViewport({ ratio: 1 });
      await expect(page.getByText(messages.disclaimer.short, { exact: true })).toBeInViewport({
        ratio: 1,
      });
      const introBox = await page.getByTestId(testIds.start.intro).boundingBox();
      const promptBox = await page.getByTestId(testIds.start.prompt).boundingBox();
      expect((introBox?.y ?? 0) + (introBox?.height ?? 0)).toBeLessThanOrEqual(promptBox?.y ?? 0);
      await capture(page, variant, "01-start");
      await checkScreen(page, "開始");

      await page.getByTestId(testIds.start.originSearch).fill(ja ? "大阪" : "osaka");
      await expect(page.getByTestId(testIds.start.originOption("大阪"))).toBeVisible();
      await capture(page, variant, "02-start-search");
      await checkScreen(page, "開始（検索中）");
      await page.getByTestId(testIds.start.originSearch).fill("");

      // 地図の丸を触ってエリアへ寄り、駅を触るとシートに路線が並ぶ
      await page.getByTestId(testIds.start.hub("umeda")).click();
      await expect(page.getByTestId(testIds.start.intro)).toHaveCount(0);
      await expect(page.getByTestId(testIds.start.place("osaka"))).toBeVisible();
      await capture(page, variant, "03-start-area");
      await checkScreen(page, "開始（エリア）");
      await page.getByTestId(testIds.start.place("osaka")).click();
      await expect(page.getByTestId(testIds.start.destinationSearch)).toBeVisible();
      await capture(page, variant, "03b-start-destination");
      await checkScreen(page, "開始（行き先）");
      await page.getByTestId(testIds.start.destinationSearch).fill(ja ? "三ノ宮" : "sannomiya");
      await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
      await expect(page.getByTestId(testIds.start.routeSummary)).toContainText(
        ja ? "JR神戸線" : "JR Kobe Line",
      );
      await capture(page, variant, "03c-start-inferred-route");
      await checkScreen(page, "開始（乗る電車の推定）");
      await expect(page.getByTestId(testIds.start.trip)).toContainText(ja ? "三ノ宮" : "Sannomiya");
      await expect(page.getByTestId(testIds.start.destinationPin)).toBeVisible();
      // 様子の段は、原因・止まってからの時間・再開の見込みの 3 問を 1 タップずつ聞く
      await capture(page, variant, "04-situation-cause");
      await checkScreen(page, "状況の入力（原因）");
      await page.getByTestId(testIds.start.cause("unknown")).click();
      await expect(page.getByTestId(testIds.start.answer("cause"))).toBeVisible();
      await capture(page, variant, "05a-situation-elapsed");
      await checkScreen(page, "状況の入力（経過）");
      await page.getByTestId(testIds.start.elapsed("m10")).click();
      await expect(page.getByTestId(testIds.start.answer("elapsed"))).toBeVisible();
      await capture(page, variant, "05c-situation-resume");
      await checkScreen(page, "状況の入力（再開見込み）");
      // 時刻を言っていたを押すと、その場で時刻の候補が開く
      await page.getByTestId(testIds.start.resume("stated")).click();
      await expect(page.locator("[data-testid^='start-resume-time-']")).toHaveCount(8);
      await capture(page, variant, "05d-situation-resume-time");
      await checkScreen(page, "状況の入力（再開見込みの時刻）");
      await page.getByTestId(testIds.start.back).click();
      await page.getByTestId(testIds.start.back).click();
      await expect(page.getByTestId(testIds.start.cause("unknown"))).toBeVisible();
      await page.getByTestId(testIds.start.method("paste")).click();
      await page
        .getByTestId(testIds.situation.pasteInput)
        .fill("人身事故のため、運転を見合わせています。現在、現場の確認を行っています。");
      await capture(page, variant, "05b-situation-ready");
      await checkScreen(page, "状況の入力（判断の直前）");
      await page.getByTestId(testIds.situation.submit("paste")).click();

      await expect(page.getByTestId(testIds.judgment.reasoningStep("phase"))).toBeVisible({
        timeout: 30_000,
      });
      await capture(page, variant, "06-judgment-reasoning");
      await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
        timeout: 30_000,
      });
      await capture(page, variant, "07-judgment");
      await capture(page, variant, "08-judgment-full", true);
      await checkScreen(page, "判断");
      if (variant.width === mobile.width) await expectFirstViewport(page, variant, "判断");

      if (variant.width === mobile.width) {
        await openSheet(page, "half");
        await capture(page, variant, "07b-judgment-half");
        await openSheet(page, "full");
        await capture(page, variant, "07c-judgment-full");
        await checkScreen(page, "判断（全部開いた状態）");
        await openSheet(page, "collapsed");
      }
      await page.getByTestId(testIds.app.menuButton).click();
      await expect(page.getByTestId(testIds.app.menu)).toBeVisible();
      await capture(page, variant, "08b-menu");
      await checkScreen(page, "メニュー");
      await page.getByTestId(testIds.app.aboutLink).click();
      await expect(page.getByTestId(testIds.about.screen)).toBeVisible({ timeout: 30_000 });
      await capture(page, variant, "09-about", true);
      await checkScreen(page, "このアプリについて");

      await page.goto("/no-such-page");
      await expect(page.getByTestId(testIds.status.screen)).toBeVisible({ timeout: 30_000 });
      await capture(page, variant, "16-not-found");
      await checkScreen(page, "見つからない頁");
    });

    test("リプレイ", async ({ page }) => {
      if (!scenario || !switchAfter) throw new Error("シナリオがありません");
      await page.goto("/replay");
      await expect(page.getByTestId(testIds.replay.scenario(scenario.id))).toBeVisible({
        timeout: 60_000,
      });
      await capture(page, variant, "10-replay-list");
      await checkScreen(page, "リプレイ一覧");

      await page.getByTestId(testIds.replay.scenario(scenario.id)).click();
      await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "idle");
      await capture(page, variant, "11-replay-ready");
      await checkScreen(page, "リプレイ開始前");

      for (const entry of scenario.timeline) {
        await page.getByTestId(testIds.replay.nextButton).click();
        await waitForJudged(page, entry.id);
        if (entry.id === switchAfter) break;
      }
      await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
        timeout: 30_000,
      });
      await capture(page, variant, "12-replay");
      await checkScreen(page, "リプレイ");
      if (variant.width === mobile.width) {
        await expectFirstViewport(page, variant, "リプレイ");
        await openSheet(page, "half");
        await capture(page, variant, "13-replay-half");
      }
    });

    test("リプレイ（気象を使う事象）", async ({ page }) => {
      if (!weatherScenario || !weatherWaitAfter)
        throw new Error("気象を使う事象のシナリオがありません");
      await page.goto(`/replay?scenario=${weatherScenario.id}`);
      await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "idle", {
        timeout: 60_000,
      });
      for (const entry of weatherScenario.timeline) {
        await page.getByTestId(testIds.replay.nextButton).click();
        await waitForJudged(page, entry.id);
        if (entry.id === weatherWaitAfter) break;
      }
      await expect(page.getByTestId(testIds.judgment.weather)).toBeVisible();
      await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
        timeout: 30_000,
      });
      await capture(page, variant, "16-replay-weather");
      await checkScreen(page, "リプレイ（気象）");
      if (variant.width === mobile.width) {
        await expectFirstViewport(page, variant, "リプレイ（気象）");
        await openSheet(page, "half");
        await expect(page.getByTestId(testIds.judgment.weather)).toBeInViewport();
      }
      await capture(page, variant, "17-replay-weather-chart");
    });
  });
}

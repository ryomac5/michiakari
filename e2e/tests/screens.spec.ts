/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import en from "../../apps/web/messages/en.json" with { type: "json" };
import jaMessages from "../../apps/web/messages/ja.json" with { type: "json" };
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { expectJudgmentOpened, openAddInfo, waitForJudgmentReady } from "../support/add-info.ts";
import {
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
const small = { width: 375, height: 667 };
const desktop = { width: 1280, height: 800 };
const variants: Variant[] = [
  { name: "ja-dark-390", locale: "ja", theme: "dark", ...mobile },
  { name: "ja-light-390", locale: "ja", theme: "light", ...mobile },
  { name: "en-dark-390", locale: "en", theme: "dark", ...mobile },
  { name: "en-light-390", locale: "en", theme: "light", ...mobile },
  // 小さいスマートフォンでも横にはみ出さず、押せる部品が 44px 以上あること
  { name: "ja-light-375", locale: "ja", theme: "light", ...small },
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
// 気象を使う事象のシナリオは、core の事象の種類で選ぶ。待つ判断になった観測で撮る
const weatherScenario = splitScenariosByWeather(scenarios).weather[0];
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

// シートの取っ手は、押したときは枠を出さず、キーボードで操作したときだけ枠を出す
async function expectHandleRingOnlyForKeyboard(page: Page) {
  const sheet = page.getByTestId(testIds.judgment.sheet);
  const handle = page.getByTestId(testIds.judgment.sheetHandle);
  const ringStyle = () =>
    handle.evaluate((el) => {
      const bar = el.firstElementChild as HTMLElement | null;
      return bar ? getComputedStyle(bar).outlineStyle : "";
    });
  // 前のキーボードの操作で取っ手に残ったフォーカスを外し、指で押した直後の状態にする
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await handle.click();
  await expect(sheet).toHaveAttribute("data-snap", "half");
  expect(await ringStyle(), "押したときに取っ手の枠が出ている").toBe("none");
  await handle.press("ArrowDown");
  await expect(sheet).toHaveAttribute("data-snap", "collapsed");
  expect(await ringStyle(), "キーボードで操作したときに取っ手の枠が出ない").toBe("solid");
  await waitForFiniteAnimations(page);
}

// 原因の札の言葉が日本語は 2 行、英語は 3 行以内に収まり、札が画面の内側にあること
// 情報を追加するの原因の選択肢が、画面からも札からもはみ出さないこと
async function expectCauseCardsReadable(page: Page, width: number) {
  const cards = await page
    .getByTestId(testIds.judgment.addInfo)
    .locator("[data-testid^='situation-cause-']")
    .evaluateAll((elements) =>
      elements.map((el) => ({
        id: el.getAttribute("data-testid"),
        right: el.getBoundingClientRect().right,
        overflow: el.scrollWidth > el.clientWidth + 1,
      })),
    );
  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) {
    expect(card.right, `${card.id} が画面からはみ出している`).toBeLessThanOrEqual(width);
    expect(card.overflow, `${card.id} の言葉が札からはみ出している`).toBe(false);
  }
}

async function checkScreen(page: Page, label: string) {
  await expectNoHorizontalScroll(page, label);
  await expectTapTargets(page, label);
}

// スマートフォンの閉じたシートに、見出し・数字・注意書きが見え、地図が画面の半分以上残ること
// 判断の画面の数字は時刻の 1 行、リプレイの数字は右上の数字にする
// 再開の見込みは、シートを半分まで引き上げたときに見えること
async function expectFirstViewport(page: Page, variant: Variant, label: string) {
  const sheet = page.getByTestId(testIds.judgment.sheet);
  await expect(sheet, label).toHaveAttribute("data-snap", "collapsed");
  await waitForFiniteAnimations(page);
  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  const figure = page.getByTestId(
    label === "判断" ? testIds.judgment.timeLine : testIds.judgment.breakEven,
  );
  const resume = page.getByTestId(testIds.judgment.breakEvenResume);
  const disclaimer = page.getByTestId(testIds.judgment.disclaimer);
  for (const [name, locator] of [
    ["結論", conclusion],
    ["数字", figure],
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
  const sheetTop = (await sheet.boundingBox())?.y ?? 0;
  expect(sheetTop, `${label}: 閉じたシートが地図を半分以上覆っている`).toBeGreaterThanOrEqual(
    variant.height / 2,
  );
  await expect(conclusion, label).toHaveAttribute("data-action", /^(wait|switch|hold)$/);
  const lines = await page
    .getByTestId(testIds.judgment.conclusionHeadline)
    .evaluate((el) =>
      Math.round(el.scrollHeight / Number.parseFloat(getComputedStyle(el).lineHeight)),
    );
  expect(lines, `${label}: 見出しが 4 行を超えている`).toBeLessThanOrEqual(4);
  await openSheet(page, "half");
  await expect(resume, `${label}: 半分まで引き上げても再開の見込みが見えない`).toBeInViewport({
    ratio: 1,
  });
  await openSheet(page, "collapsed");
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
      // 行き先を選ぶと、そのまま判断を始める
      await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
      await expect(page.getByTestId(testIds.judgment.reasoningStep("phase"))).toBeVisible({
        timeout: 30_000,
      });
      await capture(page, variant, "06-judgment-reasoning");
      await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
      await waitForJudgmentReady(page);

      // 戻ると行程の札に、推定した乗る電車が出る
      await page.getByTestId(testIds.judgment.backButton).click();
      await expect(page.getByTestId(testIds.start.routeSummary)).toContainText(
        ja ? "JR神戸線" : "JR Kobe Line",
      );
      await capture(page, variant, "03c-start-inferred-route");
      await checkScreen(page, "開始（乗る電車の推定）");
      await expect(page.getByTestId(testIds.start.trip)).toContainText(ja ? "三ノ宮" : "Sannomiya");
      await expect(page.getByTestId(testIds.start.destinationPin)).toBeVisible();
      await page.getByTestId(testIds.start.judge).click();
      await expectJudgmentOpened(page);

      // 情報を追加するで、原因・止まってからの時間・再開の見込みを分かったときに足す
      const addInfo = await openAddInfo(page);
      await capture(page, variant, "04-add-info-cause");
      await checkScreen(page, "情報を追加する（原因）");
      if (variant.width < desktop.width) await expectCauseCardsReadable(page, variant.width);
      await addInfo.getByTestId(testIds.situation.item("elapsed")).click();
      await capture(page, variant, "05a-add-info-elapsed");
      await checkScreen(page, "情報を追加する（経過）");
      await addInfo.getByTestId(testIds.situation.option("elapsed", "m10")).click();
      await waitForJudgmentReady(page);
      await openAddInfo(page);
      await expect(addInfo.getByTestId(testIds.situation.answer("elapsed"))).toBeVisible();
      await addInfo.getByTestId(testIds.situation.item("resume")).click();
      await expect(addInfo.locator("[data-testid^='situation-resume-time-']")).toHaveCount(8);
      await capture(page, variant, "05d-add-info-resume-time");
      await checkScreen(page, "情報を追加する（再開見込みの時刻）");
      await addInfo.getByTestId(testIds.situation.back).click();
      await addInfo.getByTestId(testIds.situation.tab("paste")).click();
      await addInfo
        .getByTestId(testIds.situation.pasteInput)
        .fill("人身事故のため、運転を見合わせています。現在、現場の確認を行っています。");
      await capture(page, variant, "05b-add-info-paste");
      await checkScreen(page, "情報を追加する（貼り付け）");
      await addInfo.getByTestId(testIds.situation.submit("paste")).click();
      await waitForJudgmentReady(page);
      await openSheet(page, "collapsed");
      await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
        timeout: 30_000,
      });
      await capture(page, variant, "07-judgment");
      await capture(page, variant, "08-judgment-full", true);
      await checkScreen(page, "判断");
      if (variant.width === mobile.width) await expectFirstViewport(page, variant, "判断");

      if (variant.width === mobile.width) {
        await expectHandleRingOnlyForKeyboard(page);
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

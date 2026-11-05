/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { chooseTrainDirection } from "../support/entry.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 入口で「電車の中・駅と駅の間」を選んだ人の判断
// 追加の問いは出さず、次の駅・種別・前の列車を既定値で置いて判断を出す。前提は判断の画面のチップで直せる
// 結論は次の駅に着いてからの行動で書き、「あと N 分」で始めない。決定論モードの agent とダミーの内容で確かめる

const screenshotRoot = fileURLToPath(new URL("../screenshots/between-stations/", import.meta.url));

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(150_000);

async function capture(page: Page, theme: string, name: string): Promise<void> {
  await waitForFiniteAnimations(page);
  const dir = `${screenshotRoot}${theme}/`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}${name}.png` });
}

type Box = { l: number; t: number; r: number; b: number };
type StationBox = Box & { id: string; placement: string };

// 地図の札が重なっている組を、日本語の一文で返す。重なりが無ければ空の配列
// 札は「いま」の札と「降りる駅」の札、駅の印は現在地と降りる駅と吹き出しの駅。吹き出しの印は札の置く向きから求める
async function listMapLabelOverlaps(page: Page): Promise<string[]> {
  const read = await page.evaluate(() => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    };
    const one = (selector: string) => {
      const el = document.querySelector(selector);
      return el ? box(el) : null;
    };
    return {
      width: window.innerWidth,
      hereLabel: one("[data-testid='judgment-map-here'] > div"),
      hereDot: one("[data-testid='judgment-map-here']"),
      alightLabel: one("[data-testid='judgment-map-alight'] > p"),
      alightDot: one("[data-testid='judgment-map-alight']"),
      toggle: one("[data-testid='judgment-map-view-toggle']"),
      stations: [...document.querySelectorAll("[data-testid^='judgment-map-station-']")].map(
        (el): StationBox => ({
          ...box(el),
          id: el.getAttribute("data-testid") ?? "",
          placement: el.getAttribute("data-placement") ?? "",
        }),
      ),
    };
  });
  const { hereLabel, hereDot, alightLabel, alightDot, toggle } = read;
  if (!hereLabel || !hereDot || !alightLabel || !alightDot || !toggle)
    return ["地図の札が見つからない"];

  const overlaps = (a: Box, b: Box) =>
    Math.min(a.r, b.r) > Math.max(a.l, b.l) && Math.min(a.b, b.b) > Math.max(a.t, b.t);
  const around = (cx: number, cy: number, radius: number): Box => ({
    l: cx - radius,
    t: cy - radius,
    r: cx + radius,
    b: cy + radius,
  });
  // 吹き出しは、駅の印から 12px 離して、印の上下左右のどれかに置く
  const stationMark = (s: StationBox): Box => {
    const cx = (s.l + s.r) / 2;
    const cy = (s.t + s.b) / 2;
    if (s.placement === "top") return around(cx, s.b + 12, 8);
    if (s.placement === "bottom") return around(cx, s.t - 12, 8);
    if (s.placement === "left") return around(s.r + 12, cy, 8);
    return around(s.l - 12, cy, 8);
  };
  const marks: [string, Box][] = [
    ["現在地の印", hereDot],
    // 降りる駅の印は、外側の輪（6px）までを印とする
    ["降りる駅の印", around((alightDot.l + alightDot.r) / 2, (alightDot.t + alightDot.b) / 2, 14)],
    ...read.stations.map((s): [string, Box] => [`${s.id} の印`, stationMark(s)]),
  ];
  const labels: [string, Box][] = [
    ["「いま」の札", hereLabel],
    ["「降りる駅」の札", alightLabel],
  ];

  const found: string[] = [];
  if (overlaps(hereLabel, alightLabel)) found.push("「いま」の札と「降りる駅」の札が重なっている");
  for (const [name, label] of labels) {
    for (const [markName, mark] of marks) {
      if (overlaps(label, mark)) found.push(`${name}が${markName}に重なっている`);
    }
    for (const s of read.stations) {
      if (overlaps(label, s)) found.push(`${name}が ${s.id} の吹き出しに重なっている`);
    }
    if (overlaps(label, toggle)) found.push(`${name}が「全体を見る」のボタンに重なっている`);
    if (label.l < 0 || label.r > read.width || label.t < 0)
      found.push(`${name}が画面の外にはみ出している`);
  }
  for (const [i, s] of read.stations.entries()) {
    for (const other of read.stations.slice(i + 1)) {
      if (overlaps(s, other)) found.push(`${s.id} と ${other.id} の吹き出しが重なっている`);
    }
    for (const [markName, mark] of marks) {
      if (markName !== `${s.id} の印` && overlaps(s, mark))
        found.push(`${s.id} の吹き出しが${markName}に重なっている`);
    }
  }
  return found;
}

// 大阪から JR 神戸線で三ノ宮へ向かう途中、塚本の手前で止まった想定。いまどこの段まで進める
async function reachPositionStep(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await chooseTrainDirection(page, "JR神戸線", "神戸");
  await expect(page.getByTestId(testIds.start.positionBetween)).toBeVisible();
}

// 駅と駅の間を選び、人身事故・10 分くらい・見込みは言っていないで判断を始める
async function startBetweenStations(page: Page): Promise<void> {
  await page.getByTestId(testIds.start.positionBetween).click();
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  // 駅間の後に行き先を答え、様子へ進む
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", "cause");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("塚本");
  await page.getByTestId(testIds.start.cause("passenger")).click();
  await page.getByTestId(testIds.start.causeKind("person")).click();
  await page.getByTestId(testIds.start.elapsed("m10")).click();
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`駅と駅の間 ${theme}`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([
        { name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" },
        { name: "theme", value: theme, url: baseURL ?? "" },
      ]);
    });

    test("駅と駅の間を選ぶと、追加の問いなしで判断が出て、見出しに既定の次の駅の名前が入る", async ({
      page,
    }) => {
      await reachPositionStep(page);
      await capture(page, theme, "01-entry-position");
      await startBetweenStations(page);

      // 見出しは次の駅に着いてからの行動で、「あと N 分」で始まらない
      const headline = page.getByTestId(testIds.judgment.conclusionHeadline);
      await expect(headline).toContainText("塚本");
      await expect(headline).not.toHaveText(/^あと\s?\d+\s?分/);
      await expect(headline).not.toContainText(/まで待って/);
      // 塚本は別の鉄道の駅まで歩いて 20 分以上かかるが、鉄道の代替があるので、タクシーには切り替えない
      await expect(headline).not.toContainText("タクシー");

      // 前提のチップは既定値の見た目で、前の列車はふだんの運転から推し量った並びになる
      const next = page.getByTestId(testIds.judgment.trainPositionChip("next"));
      await expect(next).toContainText("塚本");
      await expect(next).toHaveAttribute("data-source", "default");
      const own = page.getByTestId(testIds.judgment.trainPositionChip("own"));
      await expect(own).toContainText("普通に乗車");
      await expect(own).toHaveAttribute("data-source", "default");
      const ahead = page.getByTestId(testIds.judgment.trainPositionChip("ahead"));
      await expect(ahead).toContainText("ふだんの間隔と推定");
      await expect(ahead).toContainText("推定");
      await expect(ahead).toHaveAttribute("data-source", "default");
      await expect(page.getByTestId(testIds.judgment.trainPositionHint)).toContainText(
        "前の列車の種類が分かると",
      );
      await expect(page.getByTestId(testIds.judgment.disclaimer)).toContainText(
        "推定であり、公式発表を優先してください",
      );
      // 既定値の理由は、ふだんの間隔とみた見込みを言い、「入れない」とは書かない
      const reason = page.getByTestId(testIds.judgment.conclusionReasonDetail);
      await expect(reason).toContainText("ふだんどおり");
      await expect(reason).not.toContainText("入れない");

      // 利用者は大阪と塚本の間にいる。上部の帯と現在地の札は駅の間にいることを出し、塚本は降りる駅として目立たせる
      await expect(page.getByTestId(testIds.judgment.tripSummary)).toContainText("大阪〜塚本");
      await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
        timeout: 30_000,
      });
      await expect(page.getByTestId(mapTestIds.here)).toContainText("大阪〜塚本の間");
      await expect(page.getByTestId(mapTestIds.alight)).toContainText("塚本");
      // 「いま」の札と「降りる駅」の札は、互いにも、駅の印にも、「全体を見る」のボタンにも重ならない
      await expect.poll(() => listMapLabelOverlaps(page), { timeout: 15_000 }).toEqual([]);
      await capture(page, theme, "02-judgment-chips-closed");

      // チップを押すと、その場で直せる選択が開く。閉じたシートでは下が切れるので、半分まで開く
      await ahead.click();
      await expect(page.getByTestId(testIds.judgment.sheet)).toHaveAttribute("data-snap", "half");
      const editor = page.getByTestId(testIds.judgment.trainPositionEditor);
      await expect(editor).toHaveAttribute("data-kind", "ahead");
      await expect(editor).toContainText("列車走行位置の画面で確かめられます");
      await capture(page, theme, "03-judgment-chips-open");
    });
  });
}

test("別の鉄道の駅まで歩いて 20 分以上かかる塚本でも、地図の歩ける駅が代替手段に入り、タクシーは勧めず運賃つきで残る", async ({
  page,
}) => {
  await reachPositionStep(page);
  await startBetweenStations(page);

  // 結論は鉄道の代替への切り替えで、見出しにも理由にもタクシーは出ない
  await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
    "data-action",
    "switch",
  );
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).not.toContainText("タクシー");
  await expect(page.getByTestId(testIds.judgment.conclusionReasonDetail)).not.toContainText(
    "タクシー",
  );

  // 地図の歩ける駅は代替手段の探索の候補でもある。徒歩は通常の上限の 15 分を超え、おすすめは 1 つだけ
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  const bubbles = page.locator("[data-testid^='judgment-map-station-']");
  await expect.poll(() => bubbles.count()).toBeGreaterThanOrEqual(2);
  for (const bubble of await bubbles.all()) {
    expect(Number(await bubble.getAttribute("data-walk-minutes"))).toBeGreaterThan(15);
  }
  await expect(bubbles.and(page.locator("[data-recommended='true']"))).toHaveCount(1);

  // 選択肢は、歩いて乗りに行く鉄道の代替が推奨になり、タクシーは運賃と一緒に並ぶ
  await openSheet(page, "full");
  const recommended = page.locator("[data-testid^='judgment-option-'][data-recommended='true']");
  await expect(recommended).toHaveCount(1);
  await expect(recommended).toHaveAttribute("data-kind", "transfer");
  const taxi = page.getByTestId(testIds.judgment.option("taxi"));
  await expect(taxi).toHaveAttribute("data-kind", "taxi");
  await expect(taxi).toHaveAttribute("data-recommended", "false");
  await expect(taxi).toContainText(/\d,\d{3}/);
});

test("判断の画面で前の列車のチップを押し、快速と普通を並べて直すと、判断が出し直され、理由に種別の事情が入る", async ({
  page,
}) => {
  await reachPositionStep(page);
  await startBetweenStations(page);

  // 近い順に快速、普通と押して並べ、この前提で判断し直す
  await page.getByTestId(testIds.judgment.trainPositionChip("ahead")).click();
  await expect(page.getByTestId(testIds.judgment.sheet)).toHaveAttribute("data-snap", "half");
  await page.getByTestId(testIds.judgment.trainPositionAheadAdd("rapid")).click();
  await page.getByTestId(testIds.judgment.trainPositionAheadAdd("local")).click();
  await expect(page.locator("[data-testid^='judgment-train-position-ahead-item-']")).toHaveCount(2);
  await page.getByTestId(testIds.judgment.trainPositionApply).click();

  // 直したチップは確定した見た目になり、目の前に詰まっている列車として出る。推定の注記は消える
  const ahead = page.getByTestId(testIds.judgment.trainPositionChip("ahead"));
  await expect(ahead).toHaveAttribute("data-source", "user");
  await expect(ahead).toContainText("前に詰まっている列車 快速・普通");
  await expect(ahead).not.toContainText("推定");
  await expect(page.getByTestId(testIds.judgment.trainPositionHint)).toHaveCount(0);

  // 判断が出し直され、理由に「前の快速は塚本に止まれない」事情が入る。「入れない」とは書かない
  await openSheet(page, "half");
  const reason = page.getByTestId(testIds.judgment.conclusionReasonDetail);
  await expect(reason).toContainText("前の快速は塚本に止まれず", { timeout: 30_000 });
  await expect(reason).toContainText("手前で止まっています");
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).toContainText("再開後");
  await expect(reason).not.toContainText("入れない");
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready");
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toContainText("塚本");
});

test("持ち込んだ走行位置画像の種別を判断入力に使う", async ({ page }) => {
  await reachPositionStep(page);
  await startBetweenStations(page);
  await openSheet(page, "full");
  const addInfo = page.getByTestId(testIds.judgment.addInfo);
  await addInfo.getByTestId(testIds.situation.tab("photo")).click();

  // 自作の画像 fixture。決定論モードでは名前に明示した並びを読む
  await addInfo.getByTestId(testIds.situation.photoInput).setInputFiles({
    name: "fixture-train-movement--rapid+local.png",
    mimeType: "image/png",
    buffer: readFileSync(new URL("../fixtures/tiles/pale.png", import.meta.url)),
  });
  await expect(addInfo.getByTestId(testIds.situation.photoPreview)).toBeVisible();
  await addInfo.getByTestId(testIds.situation.submit("photo")).click();
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready", {
    timeout: 30_000,
  });
  await openSheet(page, "half");
  await expect(page.getByTestId(testIds.judgment.conclusionReasonDetail)).toContainText(
    "前の快速は塚本に止まれず",
  );
  const ahead = page.getByTestId(testIds.judgment.trainPositionChip("ahead"));
  await expect(ahead).toContainText("前に詰まっている列車 快速・普通");
  await expect(ahead).toHaveAttribute("data-source", "user");
  await openSheet(page, "full");
  await expect(page.getByTestId(testIds.judgment.premise)).toContainText(
    "走行位置の画像から前の列車を 快速・普通 と読みました",
  );

  // 次の入力でも、読み取った並びを保持して判断する
  await addInfo.getByTestId(testIds.situation.tab("paste")).click();
  await addInfo.getByTestId(testIds.situation.pasteInput).fill("引き続き運転を見合わせています");
  const nextRequest = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/judge",
  );
  await addInfo.getByTestId(testIds.situation.submit("paste")).click();
  expect((await nextRequest).postDataJSON().trainPosition).toMatchObject({
    trainsAhead: ["rapid", "local"],
    trainsAheadCount: null,
    trainsAheadHeadwayMinutes: null,
  });
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready", {
    timeout: 30_000,
  });
  await expect(ahead).toContainText("前に詰まっている列車 快速・普通");
  await expect(page.getByTestId(testIds.judgment.premise)).toContainText(
    "走行位置の画像から前の列車を 快速・普通 と読みました",
  );

  // 通信失敗後のリトライでも、画像の並びを判断入力に戻す
  await page.route("**/judge", (route) => route.abort(), { times: 1 });
  await addInfo.getByTestId(testIds.situation.pasteInput).fill("再開の見込みはまだ未定です");
  await addInfo.getByTestId(testIds.situation.submit("paste")).click();
  const retry = page.getByTestId(testIds.judgment.retryButton);
  await expect(retry).toBeVisible();
  const retryRequest = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/judge",
  );
  await retry.click();
  expect((await retryRequest).postDataJSON().trainPosition).toMatchObject({
    trainsAhead: ["rapid", "local"],
    trainsAheadCount: null,
    trainsAheadHeadwayMinutes: null,
  });
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready", {
    timeout: 30_000,
  });
  await expect(ahead).toContainText("前に詰まっている列車 快速・普通");
});

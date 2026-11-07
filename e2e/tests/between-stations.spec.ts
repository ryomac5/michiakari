/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import {
  addAnswers,
  expectJudgmentAfterDirection,
  expectJudgmentOpened,
} from "../support/add-info.ts";
import { chooseBetweenStations, searchStationPair } from "../support/entry.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// 入口で「駅と駅の間で止まっている」を選んだ人の判断
// 追加の問いは出さず、次の駅・種別・前の列車を既定値で置いて判断を出す。前提は判断の画面のチップで直せる
// 車内からは降りられない。結論は車内で待つだけにし、選択肢の一覧・乗り換え候補の駅・バス停を出さない
// 着いた後のほうが早い手段があるときだけ、着いた後の次の一手を 1 行で添える。決定論モードの agent とダミーの内容で確かめる

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
      edge: one("[data-testid='judgment-map-destination-edge']"),
      stations: [...document.querySelectorAll("[data-testid^='judgment-map-station-']")].map(
        (el): StationBox => ({
          ...box(el),
          id: el.getAttribute("data-testid") ?? "",
          placement: el.getAttribute("data-placement") ?? "",
        }),
      ),
    };
  });
  // 降りる駅の札は、次の駅で降りるときだけ出る。行き先の縁の札は、行き先が画面の外のときだけ出る
  const { hereLabel, hereDot, alightLabel, alightDot, toggle, edge } = read;
  if (!hereLabel || !hereDot || !toggle) return ["地図の札が見つからない"];

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
    // 降りる駅の印は、外側の輪の 6px までを印とする
    ...(alightDot
      ? [
          [
            "降りる駅の印",
            around((alightDot.l + alightDot.r) / 2, (alightDot.t + alightDot.b) / 2, 14),
          ] as [string, Box],
        ]
      : []),
    ...read.stations.map((s): [string, Box] => [`${s.id} の印`, stationMark(s)]),
  ];
  const labels: [string, Box][] = [
    ["「いま」の札", hereLabel],
    ...(alightLabel ? [["「降りる駅」の札", alightLabel] as [string, Box]] : []),
    ...(edge ? [["行き先の縁の札", edge] as [string, Box]] : []),
  ];

  const found: string[] = [];
  for (const [i, [name, label]] of labels.entries()) {
    for (const [otherName, other] of labels.slice(i + 1)) {
      if (overlaps(label, other)) found.push(`${name}と${otherName}が重なっている`);
    }
  }
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

// 大阪から JR 神戸線で三ノ宮へ向かう途中、塚本の手前で止まった想定。駅の間を確かめる問いまで進める
async function reachPositionStep(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await page.getByTestId(testIds.start.positionTrain).click();
  await searchStationPair(page, "大阪", "塚本");
  await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveText(
    "JR神戸線の大阪〜塚本の間ですか",
  );
}

// 駅と駅の間を選び、行き先を答えて判断を出す。人身事故・10 分くらいは情報を追加するで足す。行き先は既定で三ノ宮
// 再開の見込みは既定で、選べるうち最も遅い時刻を聞いたことにする。見込みの時刻が出ると、前の列車を詰める動きが始まる
async function startBetweenStations(
  page: Page,
  destination: { search: string; name: string } = { search: "さんのみや", name: "三ノ宮" },
  resume: "stated" | "unknown" = "stated",
): Promise<void> {
  await page.getByTestId(testIds.start.gpsConfirm).click();
  await page.getByTestId(testIds.start.destinationSearch).fill(destination.search);
  await page.getByTestId(testIds.start.destinationOption(destination.name)).click();
  // 行き先が JR神戸線の先に無ければ、神戸方面を答える
  await expectJudgmentAfterDirection(page, "神戸");
  await expect(page.getByTestId(testIds.judgment.tripSummary)).toContainText("塚本");
  await addAnswers(page, {
    cause: "person",
    protection: "notHeard",
    elapsed: "m10",
    resume: resume === "stated" ? { time: "last" } : "unknown",
  });
  await openSheet(page, "collapsed");
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible();
}

// 車内で待つ結論の共通の形。選択肢の一覧・バス停・乗り換え候補の駅・確率の帯を出さず、係員の案内の文も出さない
async function expectInCarWait(page: Page): Promise<void> {
  await expect(page.getByTestId(testIds.judgment.conclusion)).toHaveAttribute(
    "data-action",
    "wait",
  );
  const headline = page.getByTestId(testIds.judgment.conclusionHeadline);
  await expect(headline).toHaveText("車内で待つ");
  await expect(page.getByTestId(testIds.judgment.screen)).not.toContainText("係員の案内");
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toContainText(
    "推定であり、公式発表を優先してください",
  );
  await expect(page.getByTestId(testIds.judgment.resumeChance)).toHaveCount(0);
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await expect(page.locator("[data-testid^='judgment-map-station-']")).toHaveCount(0);
  await openSheet(page, "full");
  await expect(page.getByTestId(testIds.judgment.options)).toHaveCount(0);
  await expect(page.locator("[data-testid^='judgment-option-']")).toHaveCount(0);
  await expect(page.getByTestId(testIds.judgment.busChecks)).toHaveCount(0);
  await openSheet(page, "collapsed");
}

// 閉じたシートでは結論の見出しが先頭に見え、前提のチップは見出しと理由と注意書きより下にある
async function expectConclusionFirst(page: Page): Promise<void> {
  await expect(page.getByTestId(testIds.judgment.sheet)).toHaveAttribute("data-snap", "collapsed");
  const headline = page.getByTestId(testIds.judgment.conclusionHeadline);
  await expect(headline).toBeInViewport();
  const top = async (testId: string) => (await page.getByTestId(testId).boundingBox())?.y ?? 0;
  const disclaimer = await page.getByTestId(testIds.judgment.disclaimer).boundingBox();
  const chips = await page.getByTestId(testIds.judgment.trainPosition).boundingBox();
  if (!disclaimer || !chips) throw new Error("注意書きか前提のチップが見つかりません");
  expect(await top(testIds.judgment.conclusionHeadline)).toBeLessThan(
    await top(testIds.judgment.conclusionReason),
  );
  expect(chips.y).toBeGreaterThanOrEqual(disclaimer.y + disclaimer.height);
  // 閉じたシートの中で、見出しより上に前提の札は無い
  await expect(page.getByTestId(testIds.judgment.trainPositionChip("ahead"))).not.toBeInViewport();
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`駅と駅の間 ${theme}`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([
        { name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" },
        { name: "theme", value: theme, url: baseURL ?? "" },
      ]);
    });

    test("駅と駅の間を選ぶと、追加の問いなしで車内で待つ判断が出て、動く時刻と次の駅に着く時刻を添える", async ({
      page,
    }) => {
      await reachPositionStep(page);
      await capture(page, theme, "01-entry-position");
      await startBetweenStations(page);

      // 見出しは車内で待つだけで、2 文目に列車が動き出す時刻を出す。乗り換えやタクシーは勧めない
      // 再開の前に塚本まで進める既定値でも、動く時刻を出し、塚本に着く時刻は理由に書く
      await expectInCarWait(page);
      await expect(page.getByTestId(testIds.judgment.conclusionNext)).toHaveText(
        /^動くのは\d+時\d+分ごろの見込み$/,
      );
      await expect(page.getByTestId(testIds.judgment.conclusionReason)).toHaveText(
        /^塚本には\d+時\d+分ごろに着く見込みです。$/,
      );

      // 閉じたシートは結論から始まり、前提のチップは見出しと理由と注意書きの下に置く
      await expectConclusionFirst(page);

      // 前提のチップは既定値の見た目で、前の列車はふだんの運転から推し量った並びになる
      const next = page.getByTestId(testIds.judgment.trainPositionChip("next"));
      await expect(next).toContainText("塚本");
      await expect(next).toHaveAttribute("data-source", "default");
      const own = page.getByTestId(testIds.judgment.trainPositionChip("own"));
      await expect(own).toContainText("普通に乗車");
      await expect(own).toHaveAttribute("data-source", "default");
      const ahead = page.getByTestId(testIds.judgment.trainPositionChip("ahead"));
      await expect(ahead).toContainText("通常の間隔と推定");
      await expect(ahead).toContainText("推定");
      await expect(ahead).toHaveAttribute("data-source", "default");
      await expect(page.getByTestId(testIds.judgment.trainPositionHint)).toContainText(
        "前の列車の種類が分かると",
      );
      // 既定値の理由は着く見込みだけを言う。間隔の仮定はチップが示すので、文で繰り返さない
      const reason = page.getByTestId(testIds.judgment.conclusionReason);
      await expect(reason).toHaveText(/^.+には\d{1,2}時\d{2}分ごろに着く見込みです。$/);
      await expect(reason).not.toContainText(/仮定|ふだん|入れない/);

      // 利用者は大阪と塚本の間にいる。上部の帯と現在地の札は駅の間にいることを出す
      // 三ノ宮まで乗り続ける判断なので、塚本を降りる駅として出さない
      await expect(page.getByTestId(testIds.judgment.tripSummary)).toContainText("大阪〜塚本");
      // 人身事故は区間を止めるので、上部の札は見合わせにする
      // 発表に区間が無いので、駅の間の位置から区間を作って描かず、札も添えない
      await expect(page.getByTestId(testIds.judgment.statusChip)).toContainText("見合わせ");
      await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-blocked", "false");
      await expect(page.getByTestId(mapTestIds.blockedTag)).toHaveCount(0);
      await expect(page.getByTestId(mapTestIds.sectionNote)).toHaveCount(0);
      await expect(page.getByTestId(mapTestIds.here)).toContainText("大阪〜塚本の間");
      await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute(
        "data-in-car-plan",
        "stay",
      );
      await expect(page.getByTestId(mapTestIds.alight)).toHaveCount(0);
      // 「いま」の札は、駅の印にも、「全体を見る」のボタンにも重ならない
      await expect.poll(() => listMapLabelOverlaps(page), { timeout: 15_000 }).toEqual([]);
      await capture(page, theme, "02-judgment-closed");

      // 半分まで開くと、結論の下に前提のチップが見える
      await openSheet(page, "half");
      await expect(ahead).toBeInViewport();
      await capture(page, theme, "02-judgment-chips-half");

      // チップを押すと、その場で直せる選択が開き、シートは半分のまま保つ
      await ahead.click();
      await expect(page.getByTestId(testIds.judgment.sheet)).toHaveAttribute("data-snap", "half");
      const editor = page.getByTestId(testIds.judgment.trainPositionEditor);
      await expect(editor).toHaveAttribute("data-kind", "ahead");
      await expect(editor).toContainText("列車走行位置の画面で確かめられます");
      await capture(page, theme, "03-judgment-chips-open");
    });
  });
}

test("福島〜大阪の車内で急病人により止まり、行き先が大阪なら、車内で待ち、動く時刻だけを出し、見合わせと言わない", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await chooseBetweenStations(page, "JR環状線", "福島", "大阪");
  await page.getByTestId(testIds.start.destinationSearch).fill("大阪");
  await page.getByTestId(testIds.start.destinationOption("大阪")).click();
  await expectJudgmentOpened(page);
  // 原因と様子は判断が出てから情報を追加するで足す
  await addAnswers(page, {
    cause: "inCar",
    protection: "notHeard",
    elapsed: "now",
    resume: "unknown",
  });
  await openSheet(page, "collapsed");
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible();

  await expectInCarWait(page);
  await expect(page.getByTestId(testIds.judgment.conclusionNext)).toHaveText(
    /^動くのは\d+時\d+分ごろの見込み$/,
  );
  // 行き先が次の駅なので、着いた後の次の一手は出さない
  await expect(page.getByTestId(testIds.judgment.inCarAfterAlight)).toHaveCount(0);

  // 車内の急病人はその列車だけが止まる。見合わせの札と止まった区間の線と札を出さず、止まった場所を示す
  const status = page.getByTestId(testIds.judgment.statusChip);
  await expect(status).toHaveText("福島〜大阪で停車中");
  await expect(status).toHaveAttribute("data-scope", "train");
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-blocked", "false");
  await expect(page.getByTestId(mapTestIds.blockedTag)).toHaveCount(0);
  await expect(page.getByTestId(mapTestIds.sectionNote)).toHaveCount(0);
  await expect(page.getByTestId(mapTestIds.here)).toContainText("福島〜大阪の間");
  await expect(page.getByTestId(testIds.judgment.screen)).not.toContainText("見合わせ");
  // シートを閉じた操作の枠を外してから撮る
  await page.getByTestId(testIds.judgment.sheetHandle).blur();
  await capture(page, "light", "04-fukushima-osaka-in-car");
});

test("行き先が別の路線にあり、次の駅に着いた後のほうが早ければ、着いた後の次の一手だけを 1 行で添える", async ({
  page,
}) => {
  await reachPositionStep(page);
  await startBetweenStations(page, { search: "西宮北口", name: "西宮北口" });

  await expectInCarWait(page);
  const step = page.getByTestId(testIds.judgment.inCarAfterAlight);
  await expect(step).toBeVisible();
  await expect(step).toHaveAttribute("data-kind", "transfer");
  await expect(step).toContainText(/塚本に着いたら.+へ/);
  await expect(step).toContainText(/\d{2}:\d{2}着/);
  // 見出しと理由には切り替えを書かない
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).not.toContainText("乗り換え");
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).not.toContainText("乗り換え");
});

test("再開の見込みが出ていなければ、前の列車を詰める動きを使わず、塚本には再開後に着くと伝える", async ({
  page,
}) => {
  await reachPositionStep(page);
  await startBetweenStations(page, undefined, "unknown");

  await expectInCarWait(page);
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).toHaveText(
    /^塚本には再開後の\d{1,2}時\d{2}分ごろに着く見込みです。$/,
  );
});

test("人身事故で長く止まっても、乗ったままで三ノ宮に着けるなら、選択肢も着いた後の次の一手も出さない", async ({
  page,
}) => {
  await reachPositionStep(page);
  await startBetweenStations(page);

  await expectInCarWait(page);
  await expect(page.getByTestId(testIds.judgment.inCarAfterAlight)).toHaveCount(0);
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).not.toContainText("タクシー");
  // 理由は次の駅に着く見込みで始め、再開までの時間を事象の流れとして言い切らない
  await expect(page.getByTestId(testIds.judgment.conclusionReason)).toHaveText(
    /^塚本には\d{1,2}時\d{2}分ごろに着く見込みです。$/,
  );
  await openSheet(page, "half");
  await expect(page.getByTestId(testIds.judgment.sheet)).not.toContainText(
    /よくある流れ|ふつう|\d+(時間|分)ほどで再開/,
  );
});

test("判断の画面で前の列車のチップを押し、快速と普通を並べて直すと、判断が出し直され、理由に種別の事情が入る", async ({
  page,
}) => {
  await reachPositionStep(page);
  await startBetweenStations(page);

  // 近い順に快速、普通と押して並べ、この前提で判断し直す。チップは半分まで開くと見える
  await openSheet(page, "half");
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
  // 再開を待って動くので、見出しの 2 文目は動き出す時刻になる
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toHaveText("車内で待つ");
  await expect(page.getByTestId(testIds.judgment.conclusionNext)).toHaveText(
    /^動くのは\d+時\d+分ごろの見込み$/,
  );
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
    "走行位置の画像から、前の列車を快速・普通と読みました。",
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
    "走行位置の画像から、前の列車を快速・普通と読みました。",
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

test("駅の間で線路に降りる案内を入れると、行動の札は「待つ」でなく「案内に従う」になる", async ({
  page,
}) => {
  await reachPositionStep(page);
  await startBetweenStations(page);
  await openSheet(page, "full");
  const addInfo = page.getByTestId(testIds.judgment.addInfo);
  await addInfo.getByTestId(testIds.situation.tab("paste")).click();
  await addInfo
    .getByTestId(testIds.situation.pasteInput)
    .fill("これから線路に降りて、最寄り駅まで歩いてご案内します。");
  await addInfo.getByTestId(testIds.situation.submit("paste")).click();
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toHaveText(
    "係員の案内に従う",
    { timeout: 30_000 },
  );
  // 行動の札は開いたシートの先頭にある
  const pill = page
    .getByTestId(testIds.judgment.conclusionLead)
    .getByTestId(testIds.judgment.actionPill);
  await expect(pill).toHaveAttribute("data-label", "followStaff");
  await expect(pill).toContainText("案内に従う");
  await expect(pill).not.toContainText("待つ");
  // 分岐点の時刻と再開の見込みは出さない
  await expect(page.getByTestId(testIds.judgment.breakEvenTime)).toHaveCount(0);
  await expect(page.getByTestId(testIds.judgment.resumeChance)).toHaveCount(0);
  // 動き出す見込みが無いので、地図の上端の帯も出さない
  await expect(page.getByTestId(testIds.judgment.resumeBand)).toHaveCount(0);
});

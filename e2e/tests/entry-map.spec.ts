import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import {
  addAnswers,
  expectJudgmentOpened,
  openAddInfo,
  waitForJudgmentReady,
} from "../support/add-info.ts";
import { backToTrip, chooseTrainDirection, searchStationPair } from "../support/entry.ts";
import { openSheet, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));

// 入口の地図: 関西 → エリア → 駅の順に寄り、戻る操作で 1 段ずつ引ける
// いまどこを答えてから行き先を選ぶと、路線・方面を推定して判断を始める。様子は判断の画面で足す

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(90_000);

const kobeLine = "大阪|jr-west.東海道線|JR神戸線";
const midosuji = "心斎橋|osaka-metro.御堂筋線|地下鉄御堂筋線";
// 利用者に「分からない」と返す言い回し。結論と理由には出さない
const nonDecisive =
  /まだ判断できません|判断できません|分かりません|わかりません|情報が足りません|材料が不足|見込みが立ちません|unknown|can't|not enough information/i;

// mock は判断の途中経過を固定の架空データで返す。agent に送る要求を確かめるときは mock を外す
async function openEntry(page: Page, mock = true, station = true): Promise<void> {
  await page.goto(mock ? "/?mock=1" : "/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  if (station) await page.getByTestId(testIds.start.positionStation).click();
}

function expectStage(page: Page, stage: string) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

async function openStation(page: Page, query: string, id: string): Promise<void> {
  await page.getByTestId(testIds.start.originSearch).fill(query);
  await page.getByTestId(testIds.start.originOption(id)).click();
  await expectStage(page, "destination");
}

test("丸を触るとエリア、駅を触ると行き先が出て、戻るで1段ずつ引ける", async ({ page }) => {
  await openEntry(page);
  await expectStage(page, "kansai");
  await expect(page.getByTestId(testIds.start.prompt)).toBeVisible();
  await expect(page.getByTestId(testIds.start.sheet)).toHaveCount(0);
  await expect(page.getByTestId(testIds.start.replayLink)).toBeVisible();
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await expectStage(page, "area");
  await expect(page.getByTestId(testIds.start.prompt)).toHaveCount(0);
  for (const key of ["osaka", "umeda", "osaka-umeda"]) {
    await expect(page.getByTestId(testIds.start.place(key))).toBeVisible();
    await expect(page.getByTestId(testIds.start.areaPlace(key))).toBeVisible();
  }
  await page.getByTestId(testIds.start.place("osaka")).click();
  await expectStage(page, "destination");
  await expect(page.getByTestId(testIds.start.place("osaka"))).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId(testIds.start.line(kobeLine))).toHaveCount(0);
  await expect(page.getByTestId(testIds.start.progress)).toHaveAttribute("data-step", "1");
  await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
  await backToTrip(page);
  await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("JR神戸線");
  await expect(page.getByTestId(testIds.start.destinationPin)).toBeVisible();
  await expect(page.getByTestId(testIds.start.progress)).toHaveAttribute("data-step", "3");
  for (const stage of ["destination", "area", "kansai", "position"]) {
    await page.getByTestId(testIds.start.back).click();
    await expectStage(page, stage);
  }
  await expect(page.getByTestId(testIds.start.positionTrain)).toBeVisible();
});

test("心斎橋では先に行き先を選び、御堂筋線の方面を推定する", async ({ page }) => {
  await openEntry(page);
  await openStation(page, "心斎橋", "心斎橋");
  await expect(page.locator("[data-testid^='start-direction-']")).toHaveCount(0);
  await expect(page.getByTestId(testIds.start.destinationCandidate("梅田"))).toBeVisible();
  await expect(page.getByTestId(testIds.start.destinationCandidate("難波"))).toBeVisible();
  await expect(page.getByTestId(testIds.start.destinationSearch)).toBeVisible();
  await page.getByTestId(testIds.start.mapStop("destination-梅田")).click();
  await backToTrip(page);
  await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("新大阪・千里中央方面");
  await page.getByTestId(testIds.start.routeSummary).click();
  await expectStage(page, "station");
  await page.getByTestId(testIds.start.line(midosuji)).click();
  await expectStage(page, "direction");
  await expect(
    page.getByTestId(testIds.start.direction(`${midosuji}>osaka-metro.御堂筋線.江坂`)),
  ).toContainText("新大阪・千里中央方面");
  await expect(
    page.getByTestId(testIds.start.direction(`${midosuji}>osaka-metro.御堂筋線.中百舌鳥`)),
  ).toContainText("天王寺・なかもず方面");
  await expect(page.locator("[data-testid^='start-map-stop-direction-']")).toHaveCount(2);
  // 方面を選び直すと、そのまま判断を出し直す
  await page.getByTestId(testIds.start.direction(`${midosuji}>osaka-metro.御堂筋線.江坂`)).click();
  await expectJudgmentOpened(page);
});

test("行き先を決めず、情報を追加するで「分からない」を足しても判断が出て、前提と次に確かめることが出る", async ({
  page,
}) => {
  await openEntry(page, false, false);
  await chooseTrainDirection(page, "御堂筋線", "江坂");
  await expect(page.getByTestId(testIds.start.nearStop("本町"))).toBeVisible();
  await page.getByTestId(testIds.start.nearStop("本町")).click();
  await expectStage(page, "destination");
  await page.getByTestId(testIds.start.destinationUndecided).click();
  await backToTrip(page);
  await expect(page.getByTestId(testIds.start.trip)).toContainText("本町");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("方面の主な駅を行き先にする");
  await page.getByTestId(testIds.start.judge).click();
  await expectJudgmentOpened(page);

  // どの項目にも分からないがあり、押せばそのまま判断を出し直す
  await addAnswers(page, { protection: "unsure", elapsed: "unknown" });
  // 答えの札を押すと、その項目を選び直せる
  const addInfo = await openAddInfo(page);
  await addInfo.getByTestId(testIds.situation.answer("elapsed")).click();
  await addInfo.getByTestId(testIds.situation.option("elapsed", "unknown")).click();
  await waitForJudgmentReady(page);
  await addAnswers(page, { resume: "unknown" });
  const added = await openAddInfo(page);
  for (const item of ["protection", "elapsed", "resume"]) {
    await expect(added.getByTestId(testIds.situation.answer(item))).toBeVisible();
  }
  await openSheet(page, "collapsed");

  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toBeVisible();
  // 原因を聞き取れなくても、境目の時刻まで待ち、動かなければ乗る路線を次の手として言い切る
  await expect(conclusion).toHaveAttribute("data-action", "hold");
  await expect(page.getByTestId(testIds.judgment.confidence)).toHaveAttribute("data-level", "low");
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toHaveText(
    /^\d{1,2}時\d{2}分まで待つ$/,
  );
  await expect(page.getByTestId(testIds.judgment.conclusionNext)).toContainText("動かなければ");
  await expect(conclusion).not.toContainText(nonDecisive);
  // 境目の意味の説明は、条件の文と重なるので出さない
  await expect(page.getByText("境目の時刻までに動けば待つほうが早く着きます")).toHaveCount(0);

  // 地図は乗り換えられる駅を語る。発表に区間が無いので、御堂筋線の区間は描かず、発表で確かめると添える
  const map = page.getByTestId(testIds.judgment.map);
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(map).toHaveAttribute("data-view", "focus");
  await expect(map).toHaveAttribute("data-focus-area", /^auto:/);
  await expect(map).toHaveAttribute("data-blocked", "false");
  // 駅の吹き出しは、勧める経路で乗る駅だけにする。待つ判断なら出さない
  const bubbles = page.locator(`[data-testid^="judgment-map-station-"]`);
  const marks = Number(await map.getAttribute("data-station-marks"));
  expect(marks).toBeLessThanOrEqual(1);
  await expect.poll(() => bubbles.count()).toBe(marks);
  await expect(page.getByTestId(mapTestIds.blockedTag)).toHaveCount(0);
  await expect(page.getByTestId(mapTestIds.sectionNote)).toHaveCount(0);
  await expect(page.getByTestId(mapTestIds.here)).toContainText("本町");
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toBeVisible();
  await expect(page.getByTestId(testIds.judgment.statusChip)).toContainText("御堂筋線");

  const nextCheck = page.getByTestId(testIds.judgment.nextCheck);
  await expect(nextCheck).toContainText("再開見込み");
  await expect(nextCheck).toContainText("原因");
  expect(await nextCheck.locator("li").count()).toBeLessThanOrEqual(3);
  const premise = page.getByTestId(testIds.judgment.premise);
  await expect(premise).toContainText("方面の主な駅");
  await expect(premise).toContainText("車内の位置は本町駅と仮定しています。");
  await expect(premise).toContainText("止まった時刻はいまと仮定しています。");
  await expect(premise).toContainText("境目の時刻を動く目安");
  for (const part of [premise, nextCheck, page.getByTestId(testIds.judgment.conclusionReason)]) {
    await expect(part).not.toContainText(nonDecisive);
  }

  // 次に確かめることから、様子の入れ直しへ移れる。閉じたシートは結論だけなので、開いてから押す
  await openSheet(page, "full");
  await page.getByTestId(testIds.judgment.nextCheckAction).click();
  await expect(page.getByTestId(testIds.judgment.addInfo)).toBeInViewport();
});

test("大阪梅田から京都河原町へは路線と方面を聞かず、戻ると行き先に戻る", async ({ page }) => {
  await openEntry(page);
  await openStation(page, "大阪梅田", "大阪梅田");
  await page.getByTestId(testIds.start.destinationCandidate("京都河原町")).click();
  await backToTrip(page);
  await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("阪急京都線");
  await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("京都河原町方面");
  await page.getByTestId(testIds.start.back).click();
  await expectStage(page, "destination");
  // 選び直すと判断へ進み、端末の戻る操作は行程の札、行き先の順に引く
  await page.getByTestId(testIds.start.destinationCandidate("京都河原町")).click();
  await expectJudgmentOpened(page);
  await page.goBack();
  await expectStage(page, "cause");
  await page.goBack();
  await expectStage(page, "destination");
});

test("画面の外にある京都は、縁の札から寄れる", async ({ page }) => {
  await openEntry(page);
  await page.getByTestId(testIds.start.hubEdge("kyoto")).click();
  await expectStage(page, "area");
  await expect(page.getByTestId(testIds.start.place("kyoto"))).toBeVisible();
});

test("丸も線も無い所を触っても、そのあたりの駅へ寄る", async ({ page }) => {
  await openEntry(page);
  const box = await page.getByTestId(testIds.start.map).boundingBox();
  const width = box?.width ?? 390;
  const height = box?.height ?? 844;
  // 大阪と難波の丸の間より東の点から順に試す。線の近くなら駅の間の候補が出るので、閉じて次の点を試す
  const points = [
    { x: width - 40, y: height * 0.6 },
    { x: width - 30, y: height * 0.68 },
    { x: width - 60, y: height * 0.72 },
    { x: 40, y: height * 0.68 },
    { x: 30, y: height * 0.6 },
    { x: width - 30, y: height * 0.45 },
  ];
  for (const point of points) {
    const tag = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point);
    if (tag !== "CANVAS") continue;
    await page.mouse.click(point.x, point.y);
    const picked = page.getByTestId(testIds.start.mapPick);
    const area = page.getByTestId(testIds.start.screen).and(page.locator("[data-stage='area']"));
    await expect(picked.or(area)).toBeVisible();
    if ((await picked.count()) === 0) break;
    await page.getByTestId(testIds.start.back).click();
    await expect(picked).toHaveCount(0);
  }
  await expectStage(page, "area");
  await expect(page.locator("[data-testid^='start-area-place-']").first()).toBeVisible();
});

test("入力を終えると、選んだ路線を見合わせとして判断の画面に引き継ぐ", async ({ page }) => {
  await openEntry(page, false);
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await page.getByTestId(testIds.start.place("osaka")).click();
  await page.getByTestId(testIds.start.destinationCandidate("高槻")).click();
  await backToTrip(page);
  await expect(page.getByTestId(testIds.start.trip)).toContainText("JR京都線");

  // 行き先は行程の札から選び直せる。選び直すと判断を出し直す
  await page.getByTestId(testIds.start.editDestination).click();
  await expectStage(page, "destination");
  await page.getByTestId(testIds.start.destinationCandidate("京都")).click();
  await expectJudgmentOpened(page);
  await expect(page.getByTestId(testIds.judgment.tripSummary)).toContainText("京都");
  await expect(page.getByTestId(testIds.judgment.statusChip)).toContainText("JR京都線");

  // 選んで答える入力は路線を含まない。足したあとも、上部の帯の路線は入口で選んだ路線から来る
  await addAnswers(page, { cause: "vehicle", elapsed: "m10" });
  await expect(page.getByTestId(testIds.judgment.statusChip)).toContainText("JR京都線");

  // 判断の画面から戻ると、選んだ駅・路線・方面・行き先の行程の札から再開する
  await page.goBack();
  await expectStage(page, "cause");
  await expect(page.getByTestId(testIds.start.editDestination)).toContainText("京都");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("JR京都線");
  // 再開したあとも、端末の戻る操作は 1 段ずつ引く
  await page.goBack();
  await expectStage(page, "destination");
  await page.goBack();
  await expectStage(page, "area");
});

test("判断が出たあとの端末の戻る操作は、1 回で直前の段に戻る", async ({ page }) => {
  await openEntry(page, false);
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await page.getByTestId(testIds.start.place("osaka")).click();
  await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  // 判断が届き、地図が描けてから戻る
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });

  // 1 回目の戻るで行程の札に戻り、そのあとは 1 回ごとに 1 段ずつ引く
  await page.goBack();
  await expectStage(page, "cause");
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expectStage(page, "destination");
  await page.goBack();
  await expectStage(page, "area");
});

test("判断の画面の戻るを押すと、行程の札に戻り、出し直しのボタンで判断へ戻れる", async ({
  page,
}) => {
  await openEntry(page);
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await page.getByTestId(testIds.start.place("osaka")).click();
  await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });

  // 戻るは上部の帯の左端にあり、判断の更新中でも押せる大きさで見えている
  const back = page.getByTestId(testIds.judgment.backButton);
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute("aria-label", "戻る");
  const box = await back.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expectJudgmentOpened(page);

  // 原因と時間は情報を追加するで足し、答えの札に残る
  await addAnswers(page, { cause: "person", elapsed: "m10" });
  const addInfo = await openAddInfo(page);
  await expect(addInfo.getByTestId(testIds.situation.answer("cause"))).toContainText("人身事故");
  await expect(addInfo.getByTestId(testIds.situation.answer("elapsed"))).toContainText("約10分");

  // 押すと行程の札に戻り、行き先が残っている。戻っただけでは判断を始めない
  await back.click();
  await expect(page).toHaveURL(/\/\?mock=1$/);
  await expectStage(page, "cause");
  await expect(page.getByTestId(testIds.start.editDestination)).toContainText("三ノ宮");
  await expect(page.getByTestId(testIds.start.judge)).toBeVisible();

  // 履歴は二重にならず、端末の戻る操作は 1 回で 1 段引く
  await page.goBack();
  await expectStage(page, "destination");

  // 選び直して判断を出し、もう一度戻ると、選び直した行き先が残っている
  await page.getByTestId(testIds.start.destinationCandidate("神戸")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await back.click();
  await expectStage(page, "cause");
  await expect(page.getByTestId(testIds.start.editDestination)).toContainText("神戸");
  await page.getByTestId(testIds.start.judge).click();
  await expectJudgmentOpened(page);
});

test("端末の戻る操作でも、入口の段を 1 段ずつ引ける", async ({ page }) => {
  await openEntry(page);
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await page.getByTestId(testIds.start.place("osaka")).click();
  await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
  await backToTrip(page);

  // 選び直しも履歴を引くので、そのあとの戻る操作と食い違わない
  await page.getByTestId(testIds.start.editDestination).click();
  await expectStage(page, "destination");
  for (const stage of ["area", "kansai", "position"]) {
    await page.goBack();
    await expectStage(page, stage);
  }
  await expect(page).toHaveURL(/\/\?mock=1$/);
});

test("PC 幅では、問いかけの下のよく使う駅から駅の段へ進める", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openEntry(page);
  await expect(page.getByTestId(testIds.start.replayLink)).toBeVisible();
  await page.getByTestId(testIds.start.quickPick("namba")).click();
  await expectStage(page, "destination");
  await expect(page.getByTestId(testIds.start.place("namba"))).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.goBack();
  await expectStage(page, "kansai");
});

test("引いた地図はエリアの丸と主要な駅の名前を出し、指で寄る操作でも駅が出る", async ({ page }) => {
  await openEntry(page);
  const map = page.getByTestId(testIds.start.map);
  const places = page.locator("[data-testid^='start-place-']");
  await expect(map).toHaveAttribute("data-detail", "areas");
  // 丸がまとめる大阪駅は丸に任せ、京橋のような丸の無い主要な駅を名前付きで出す
  await expect(page.getByTestId(testIds.start.hub("umeda"))).toBeVisible();
  await expect(page.getByTestId(testIds.start.place("osaka"))).toHaveCount(0);
  await expect(page.getByTestId(testIds.start.place("京橋"))).toHaveAttribute(
    "data-label",
    "small",
  );
  // 駅にいると答えた直後の寄せが終わってから、指で寄る操作を始める
  await expect(map).toHaveAttribute("data-moving", "false");
  const hub = await page.getByTestId(testIds.start.hub("umeda")).boundingBox();
  if (!hub) throw new Error("大阪のエリアがありません");
  await page.mouse.move(hub.x + hub.width / 2, hub.y + hub.height / 2);
  for (let step = 0; step < 5; step++) {
    if ((await map.getAttribute("data-detail")) === "stations") break;
    const before = Number(await map.getAttribute("data-zoom"));
    await page.mouse.wheel(0, -2400);
    await expect
      .poll(async () => Number(await map.getAttribute("data-zoom")))
      .toBeGreaterThan(before + 0.2);
  }
  await expect(map).toHaveAttribute("data-detail", "stations");
  await expect(places.first()).toBeVisible();
  await expect(page.getByTestId(testIds.start.hub("umeda"))).toHaveCount(0);
  await places.first().click();
  await expectStage(page, "destination");
  await expect(page.getByTestId(testIds.start.destinationSearch)).toBeVisible();
});

test("京都の地図で私鉄の駅を選び、方面と行き先へ進める", async ({ page }) => {
  await openEntry(page);
  await page.getByTestId(testIds.start.hubEdge("kyoto")).click();
  await expectStage(page, "area");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-detail", "stations");
  await page.getByTestId(testIds.start.place("toji")).click();
  await expectStage(page, "destination");
  await expect(page.getByTestId(testIds.start.destinationCandidate("大和西大寺"))).toBeVisible();
  await page.getByTestId(testIds.start.destinationCandidate("大和西大寺")).click();
  await backToTrip(page);
  await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("大和西大寺");
});

test("三宮の地図で阪神を選び、利用者向けの方面と行き先が出る", async ({ page }) => {
  await openEntry(page);
  await page.getByTestId(testIds.start.hubEdge("sannomiya")).click();
  await page.getByTestId(testIds.start.place("sannomiya")).click();
  await page.getByTestId(testIds.start.destinationCandidate("大阪梅田")).click();
  await expectStage(page, "station");
  const line = "神戸三宮|hanshin.本線|阪神本線";
  await page.getByTestId(testIds.start.line(line)).click();
  await backToTrip(page);
  await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("大阪梅田");
});

test("位置情報を許可済みなら近くの駅が最初に出て、1回で選べる", async ({ context, page }) => {
  await context.setGeolocation({ latitude: 34.9855, longitude: 135.7585 });
  await context.grantPermissions(["geolocation"]);
  await openEntry(page);
  await expectStage(page, "kansai");
  await page.getByTestId(testIds.start.nearbyStation("京都")).click();
  await expectStage(page, "destination");
  await expect(page.getByTestId(testIds.start.destinationSearch)).toBeVisible();
});

test("位置情報を拒否したら地図と検索から駅を選べる", async ({ context, page }) => {
  await context.setGeolocation({ latitude: 34.9855, longitude: 135.7585 });
  await context.clearPermissions();
  await openEntry(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Browser.setPermission", {
    permission: { name: "geolocation" },
    setting: "denied",
    origin: new URL(page.url()).origin,
  });
  await page.getByTestId(testIds.start.locateButton).click();
  await expect(page.getByTestId(testIds.start.locateStatus)).toBeVisible();
  await expectStage(page, "kansai");
  await expect(page.getByTestId(testIds.start.hub("umeda"))).toBeVisible();
  await openStation(page, "神戸三宮", "神戸三宮");
});

test("駅にいる人は行き先まで答えると、路線と方面を聞かれずに判断へ進む", async ({ page }) => {
  await openEntry(page);
  await openStation(page, "大阪", "大阪");
  await expect(page.getByTestId(testIds.start.progress)).toHaveAttribute("data-step", "1");
  await expect(page.locator("[data-testid^='start-line-']")).toHaveCount(0);
  await expect(page.locator("[data-testid^='start-direction-']")).toHaveCount(0);
  await page.getByTestId(testIds.start.destinationSearch).fill("三ノ宮");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await backToTrip(page);
  await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("JR神戸線");
  await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("尼崎・三ノ宮方面");
  await expect(page.getByTestId(testIds.start.progress)).toHaveAttribute("data-step", "3");
  await page.goBack();
  await expectStage(page, "destination");
  await page.goBack();
  await expectStage(page, "kansai");
});

// 描かれた駅の札の矩形どうしの重なり。札は data-station-label の付いた面で測る
function listLabelOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll<HTMLElement>("[data-station-label]")]
      .filter((el) => el.checkVisibility())
      .map((el) => ({ name: el.textContent, rect: el.getBoundingClientRect() }));
    return boxes.flatMap((a, i) =>
      boxes.slice(i + 1).flatMap((b) => {
        const w = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
        const h = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
        return w > 0 && h > 0 ? [`${a.name} / ${b.name}`] : [];
      }),
    );
  });
}

// 各駅の印の中心と縁で、いちばん上にある要素がその駅のボタンかを調べる。隣の駅に覆われた印を返す
function listCoveredDots(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const buttons = [
      ...document.querySelectorAll<HTMLElement>("button[data-testid^='start-place-']"),
    ];
    return buttons.flatMap((button) => {
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const points = [
        [x, y],
        [x - 4, y],
        [x + 4, y],
        [x, y - 4],
        [x, y + 4],
      ] as const;
      const covered = points.flatMap(([px, py]) => {
        const hit = document.elementFromPoint(px, py)?.closest("button");
        return hit && hit !== button ? [hit.getAttribute("aria-label") ?? "?"] : [];
      });
      return covered.length > 0
        ? [`${button.getAttribute("aria-label")} ← ${[...new Set(covered)].join(",")}`]
        : [];
    });
  });
}

for (const viewport of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`${size} の入口の地図`, () => {
    test.use({ viewport });

    test("関西と大阪のエリアで札が重ならず、隣の駅の印も押せる", async ({ page }) => {
      await openEntry(page);
      const map = page.getByTestId(testIds.start.map);
      await expect(map).toHaveAttribute("data-moving", "false");
      await waitForFiniteAnimations(page);
      await page.screenshot({ path: `${screenshotDir}entry-kansai-${size}.png` });
      await expect.poll(() => listLabelOverlaps(page)).toEqual([]);
      await expect.poll(() => listCoveredDots(page)).toEqual([]);

      await page.getByTestId(testIds.start.hub("umeda")).click();
      await expect(page.getByTestId(testIds.start.place("osaka"))).toBeVisible();
      await expect(map).toHaveAttribute("data-moving", "false");
      await waitForFiniteAnimations(page);
      await page.screenshot({ path: `${screenshotDir}entry-umeda-${size}.png` });
      // 大阪のまわりの駅と、隣の福島・天満・中津まで名前付きで出す
      for (const key of ["osaka", "umeda", "osaka-umeda", "kitashinchi", "福島", "天満", "中津"]) {
        await expect(page.getByTestId(testIds.start.place(key))).toBeVisible();
        await expect(page.getByTestId(testIds.start.place(key))).not.toHaveAttribute(
          "data-label",
          "none",
        );
      }
      await expect.poll(() => listLabelOverlaps(page)).toEqual([]);
      await expect.poll(() => listCoveredDots(page)).toEqual([]);

      // 隣の駅をそれぞれ押すと、その駅が選ばれる
      for (const key of ["福島", "天満", "中津", "kitashinchi"]) {
        await page.getByTestId(testIds.start.place(key)).click();
        await expectStage(page, "destination");
        await expect(page.getByTestId(testIds.start.place(key))).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await page.getByTestId(testIds.start.back).click();
        await expectStage(page, "area");
        await expect(map).toHaveAttribute("data-moving", "false");
        await waitForFiniteAnimations(page);
      }
    });
  });
}

test("駅と駅の間では路線と方面を聞かずに駅の間を答えてから行き先を聞く", async ({ page }) => {
  await openEntry(page, true, false);
  await expectStage(page, "position");
  await page.getByTestId(testIds.start.positionTrain).click();
  await expectStage(page, "between");
  await expect(page.getByTestId(testIds.start.destinationSearch)).toHaveCount(0);
  await expect(page.getByTestId(testIds.start.progress)).toHaveAttribute("data-step", "0");
  await searchStationPair(page, "塚本", "尼崎");
  await page.getByTestId(testIds.start.gpsConfirm).click();
  await expectStage(page, "destination");
  await page.getByTestId(testIds.start.destinationSearch).fill("三ノ宮");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await backToTrip(page);
  await expect(page.getByTestId(testIds.start.trip)).toContainText("尼崎");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("駅と駅の間");
  for (const stage of ["destination", "between", "position"]) {
    await page.goBack();
    await expectStage(page, stage);
  }
});

test("駅と駅の間の人が乗る電車を選び直すと、路線・方面・駅間を答えてから行き先を聞く", async ({
  page,
}) => {
  await openEntry(page, true, false);
  await chooseTrainDirection(page, "JR神戸線", "神戸");
  await expect(page.getByTestId(testIds.start.destinationSearch)).toHaveCount(0);
  await expect(page.getByTestId(testIds.start.progress)).toHaveAttribute("data-step", "0");
  await expect(page.getByTestId(testIds.start.trainSegment)).toContainText("大阪 → 塚本");
  await page.getByTestId(testIds.start.trainSegment).selectOption({ label: "塚本 → 尼崎" });
  await page.getByTestId(testIds.start.positionBetween).click();
  await expectStage(page, "destination");
  await page.getByTestId(testIds.start.destinationSearch).fill("三ノ宮");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await backToTrip(page);
  await expect(page.getByTestId(testIds.start.trip)).toContainText("尼崎");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("駅と駅の間");
  for (const stage of [
    "destination",
    "trainPosition",
    "direction",
    "station",
    "cause",
    "destination",
    "between",
    "position",
  ]) {
    await page.goBack();
    await expectStage(page, stage);
  }
});

test("最初の段の検索から直接駅を選び、戻ると最初の段へ戻る", async ({ page }) => {
  await openEntry(page, true, false);
  await expectStage(page, "position");
  // 現在地のボタンは読み取りの 1 つだけにする
  await expect(page.getByTestId(testIds.start.gpsLocate)).toBeVisible();
  await expect(page.getByTestId(testIds.start.locateButton)).toHaveCount(0);
  await openStation(page, "大阪", "大阪");
  await expect(page.getByTestId(testIds.start.progress)).toHaveAttribute("data-step", "1");
  await page.getByTestId(testIds.start.back).click();
  await expectStage(page, "position");
  await expect(page.getByTestId(testIds.start.positionTrain)).toBeVisible();
});

test("最初の段の地図からエリアと駅を選び、戻るで1段ずつ引ける", async ({ page }) => {
  await openEntry(page, true, false);
  await expectStage(page, "position");
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await expectStage(page, "area");
  await page.getByTestId(testIds.start.place("osaka")).click();
  await expectStage(page, "destination");
  for (const stage of ["area", "position"]) {
    await page.getByTestId(testIds.start.back).click();
    await expectStage(page, stage);
  }
});

import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { mapTestIds } from "../../apps/web/src/features/map/testids.ts";
import { expect, test } from "../support/test.ts";

// 入口の地図: 関西 → エリア → 駅の順に寄り、戻る操作で 1 段ずつ引ける
// 駅を選んだら路線・方面・行き先・いまどこ・様子を同じ画面のシートで 1 問ずつ聞き、最後の一手で判断の画面へ移る

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(90_000);

const kobeLine = "大阪|jr-west.東海道線|JR神戸線";
const kyotoLine = "大阪|jr-west.東海道線|JR京都線";
const midosuji = "心斎橋|osaka-metro.御堂筋線|地下鉄御堂筋線";
// 方面の key は「路線の key>方面の終わりの駅の ID」
const toKobe = `${kobeLine}>jr-west.東海道線.神戸`;
const toKyoto = `${kyotoLine}>jr-west.東海道線.篠原`;
const midosujiNorth = `${midosuji}>osaka-metro.御堂筋線.江坂`;
const midosujiSouth = `${midosuji}>osaka-metro.御堂筋線.中百舌鳥`;
// 利用者に「分からない」と返す言い回し。結論と理由には出さない
const nonDecisive =
  /まだ判断できません|判断できません|分かりません|わかりません|情報が足りません|材料が不足|見込みが立ちません|unknown|can't|not enough information/i;

// mock は判断の途中経過を固定の架空データで返す。agent に送る要求を確かめるときは mock を外す
async function openEntry(page: Page, mock = true): Promise<void> {
  await page.goto(mock ? "/?mock=1" : "/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
}

function expectStage(page: Page, stage: string) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

async function openStation(page: Page, query: string, id: string): Promise<void> {
  await page.getByTestId(testIds.start.originSearch).fill(query);
  await page.getByTestId(testIds.start.originOption(id)).click();
  await expectStage(page, "station");
}

test("丸を触るとエリア、駅を触ると路線が出て、戻るで 1 段ずつ引ける", async ({ page }) => {
  await openEntry(page);
  await expectStage(page, "kansai");
  // 最初は問いかけと検索だけを出し、シートは出さない
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
  await expectStage(page, "station");
  await expect(page.getByTestId(testIds.start.place("osaka"))).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId(testIds.start.line(kobeLine))).toBeVisible();
  await expect(page.getByTestId(testIds.start.line(kyotoLine))).toBeVisible();
  await expect(page.getByTestId(testIds.start.progress)).toHaveAttribute("data-step", "0");

  await page.getByTestId(testIds.start.line(kobeLine)).click();
  await expectStage(page, "direction");
  await expect(page.getByTestId(testIds.start.progress)).toHaveAttribute("data-step", "1");
  await page.getByTestId(testIds.start.direction(toKobe)).click();
  await expectStage(page, "destination");
  await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
  await expectStage(page, "position");
  await page.getByTestId(testIds.start.positionStation).click();
  await expectStage(page, "cause");
  await expect(page.getByTestId(testIds.start.destinationPin)).toBeVisible();
  // 発表文や掲示を持っている人は、原因の段の下の小さな入口から撮る・貼るへ入る
  await page.getByTestId(testIds.start.method("photo")).click();
  await expectStage(page, "input");
  await expect(page.getByTestId(testIds.start.progress)).toHaveAttribute("data-step", "4");

  for (const stage of [
    "cause",
    "position",
    "destination",
    "direction",
    "station",
    "area",
    "kansai",
  ]) {
    await page.getByTestId(testIds.start.back).click();
    await expectStage(page, stage);
  }
  await expect(page.getByTestId(testIds.start.prompt)).toBeVisible();
});

test("心斎橋の御堂筋線を選ぶと方面を聞き、行き先の候補は地下鉄の駅から並ぶ", async ({ page }) => {
  await openEntry(page);
  await openStation(page, "心斎橋", "心斎橋");
  await page.getByTestId(testIds.start.line(midosuji)).click();
  await expectStage(page, "direction");

  // 方面は路線の両端の向き。地図にも同じ方面の札を置く
  await expect(page.getByTestId(testIds.start.direction(midosujiNorth))).toContainText(
    "新大阪・千里中央方面",
  );
  await expect(page.getByTestId(testIds.start.direction(midosujiSouth))).toContainText(
    "天王寺・なかもず方面",
  );
  await expect(page.locator("[data-testid^='start-map-stop-direction-']")).toHaveCount(2);

  await page.getByTestId(testIds.start.direction(midosujiNorth)).click();
  await expectStage(page, "destination");
  const candidates = page.locator("[data-testid^='start-destination-candidate-']");
  await expect(candidates.first()).toHaveAttribute("data-operator", "Osaka Metro");
  // 隣の本町は行き先としてはまれなので、先頭に出さず最後に回す
  await expect(candidates.first()).not.toHaveAttribute("data-testid", /-本町$/);
  await expect(candidates.last()).toHaveAttribute("data-testid", /-本町$/);
  // 候補は方面の先の駅だけ。JR の駅や逆の方面の駅は出さない
  await expect(page.getByTestId(testIds.start.destinationCandidate("梅田"))).toBeVisible();
  await expect(page.getByTestId(testIds.start.destinationCandidate("大阪"))).toHaveCount(0);
  await expect(page.getByTestId(testIds.start.destinationCandidate("難波"))).toHaveCount(0);
  // 方面の外の駅も検索で選べる
  await expect(page.getByTestId(testIds.start.destinationSearch)).toBeVisible();

  // 地図の札からも行き先を選べる
  await page.getByTestId(testIds.start.mapStop("destination-梅田")).click();
  await expectStage(page, "position");
});

test("全部「分からない」で進めても判断が出て、前提と次に確かめることが出る", async ({ page }) => {
  await openEntry(page, false);
  await openStation(page, "心斎橋", "心斎橋");
  await page.getByTestId(testIds.start.line(midosuji)).click();
  await page.getByTestId(testIds.start.direction(midosujiNorth)).click();

  // 行き先を決めずに進むと、方面の主な駅で考える
  await page.getByTestId(testIds.start.destinationUndecided).click();
  await expectStage(page, "position");

  // 電車の中なら、近い駅を道順に並べて聞く
  await page.getByTestId(testIds.start.positionTrain).click();
  await expect(page.locator("[data-testid^='start-near-stop-']")).toHaveCount(3);
  await page.getByTestId(testIds.start.nearStop("本町")).click();
  await expectStage(page, "cause");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("本町");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("方面の主な駅で考えます");

  // どの問いにも分からないがあり、押せばそのまま次へ進む
  await page.getByTestId(testIds.start.cause("unknown")).click();
  await expectStage(page, "elapsed");
  await page.getByTestId(testIds.start.elapsed("unknown")).click();
  await expectStage(page, "resume");
  // 答えのチップを押すと、その問いに戻って選び直せる
  await page.getByTestId(testIds.start.answer("elapsed")).click();
  await expectStage(page, "elapsed");
  await expect(page.getByTestId(testIds.start.answer("cause"))).toBeVisible();
  await page.getByTestId(testIds.start.elapsed("unknown")).click();
  await expectStage(page, "resume");
  await page.getByTestId(testIds.start.resume("unknown")).click();

  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  const conclusion = page.getByTestId(testIds.judgment.conclusion);
  await expect(conclusion).toBeVisible({ timeout: 30_000 });
  // 原因を聞き取れなくても、いまは待ち、分岐点を過ぎたら切り替える形で言い切る
  await expect(conclusion).toHaveAttribute("data-action", "hold");
  await expect(conclusion).toContainText("低");
  await expect(page.getByTestId(testIds.judgment.conclusionHeadline)).toContainText(
    /\d{1,2}時\d{2}分まで待って/,
  );
  await expect(conclusion).not.toContainText(nonDecisive);
  // 分岐点の意味を一文で添える
  await expect(page.getByTestId(testIds.judgment.breakEvenMeaning)).toContainText(
    "この時刻までに動かなければ",
  );

  // 地図は止まっている御堂筋線と、乗り換えられる駅を語る
  const map = page.getByTestId(testIds.judgment.map);
  await expect(map).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(map).toHaveAttribute("data-view", "focus");
  await expect(map).toHaveAttribute("data-focus-area", /^auto:/);
  await expect(map).toHaveAttribute("data-blocked", "true");
  const bubbles = page.locator(`[data-testid^="judgment-map-station-"]`);
  await expect.poll(() => bubbles.count()).toBeGreaterThanOrEqual(1);
  expect(await bubbles.count()).toBeLessThanOrEqual(4);
  await expect(bubbles.first()).toBeVisible();
  await expect(page.getByTestId(mapTestIds.blockedTag)).toBeVisible();
  await expect(page.getByTestId(mapTestIds.here)).toContainText("本町");
  await expect(page.getByTestId(testIds.judgment.disclaimer)).toBeVisible();
  await expect(page.getByTestId(testIds.judgment.statusChip)).toContainText("御堂筋線");

  const nextCheck = page.getByTestId(testIds.judgment.nextCheck);
  await expect(nextCheck).toContainText("再開見込み");
  await expect(nextCheck).toContainText("原因");
  expect(await nextCheck.locator("li").count()).toBeLessThanOrEqual(3);
  const premise = page.getByTestId(testIds.judgment.premise);
  await expect(premise).toContainText("方面の主な駅");
  await expect(premise).toContainText("電車の中なので、本町駅にいるとして考えています");
  await expect(premise).toContainText("止まった時刻は、いまとして数えています");
  await expect(premise).toContainText("分岐点を動く目安");
  for (const part of [premise, nextCheck, page.getByTestId(testIds.judgment.conclusionReason)]) {
    await expect(part).not.toContainText(nonDecisive);
  }

  // 次に確かめることから、様子の入れ直しへ移れる
  await page.getByTestId(testIds.judgment.nextCheckAction).click();
  await expect(page.getByTestId(testIds.judgment.addInfo)).toBeInViewport();
});

test("大阪梅田の阪急は起点なので方面を聞かずに行き先へ進み、戻ると路線の段に戻る", async ({
  page,
}) => {
  await openEntry(page);
  await openStation(page, "大阪梅田", "大阪梅田");
  await page.getByTestId(testIds.start.line("大阪梅田|hankyu.京都線|阪急京都線")).click();
  await expectStage(page, "destination");
  await expect(page.getByTestId(testIds.start.sheet)).toContainText("京都河原町方面");
  await expect(
    page.locator("[data-testid^='start-destination-candidate-']").first(),
  ).toHaveAttribute("data-operator", "阪急");
  await page.getByTestId(testIds.start.back).click();
  await expectStage(page, "station");
  // 端末の戻る操作でも、飛ばした方面の段には止まらない
  await page.getByTestId(testIds.start.line("大阪梅田|hankyu.京都線|阪急京都線")).click();
  await expectStage(page, "destination");
  await page.goBack();
  await expectStage(page, "station");
});

test("画面の外にある京都は、縁の札から寄れる", async ({ page }) => {
  await openEntry(page);
  await page.getByTestId(testIds.start.hubEdge("kyoto")).click();
  await expectStage(page, "area");
  await expect(page.getByTestId(testIds.start.place("kyoto"))).toBeVisible();
});

test("丸の無い所を触っても、そのあたりの駅へ寄る", async ({ page }) => {
  await openEntry(page);
  const box = await page.getByTestId(testIds.start.map).boundingBox();
  // 大阪と難波の丸の間より東。どの丸の札とも重ならない点
  await page.mouse.click((box?.width ?? 390) - 40, (box?.height ?? 844) * 0.6);
  await expectStage(page, "area");
  await expect(page.locator("[data-testid^='start-area-place-']").first()).toBeVisible();
});

test("入力を終えると、選んだ路線を見合わせとして判断の画面に引き継ぐ", async ({ page }) => {
  await openEntry(page, false);
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await page.getByTestId(testIds.start.place("osaka")).click();
  await page.getByTestId(testIds.start.line(kyotoLine)).click();
  // JR京都線を選んだら、京都へ向かう方面を先に出す
  await expect(page.locator("[data-testid^='start-direction-']").first()).toHaveAttribute(
    "data-testid",
    `start-direction-${toKyoto}`,
  );
  await page.getByTestId(testIds.start.direction(toKyoto)).click();
  await page.getByTestId(testIds.start.destinationCandidate("高槻")).click();
  await page.getByTestId(testIds.start.positionStation).click();
  await expect(page.getByTestId(testIds.start.trip)).toContainText("JR京都線");

  // 行き先は入力の段から選び直せる
  await page.getByTestId(testIds.start.editDestination).click();
  await expectStage(page, "destination");
  await page.getByTestId(testIds.start.destinationCandidate("京都")).click();
  await page.getByTestId(testIds.start.positionStation).click();
  await expect(page.getByTestId(testIds.start.trip)).toContainText("京都");

  await page.locator("[data-testid^='start-cause-']").first().click();
  await page.getByTestId(testIds.start.elapsed("m10")).click();
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.tripSummary)).toContainText("京都");
  // 選んで答える入力は路線を含まない。上部の帯の路線は、入口で選んだ路線から来る
  await expect(page.getByTestId(testIds.judgment.statusChip)).toContainText("JR京都線");

  // 判断の画面から戻ると、選んだ駅・路線・方面・行き先と様子の答えの状態から再開する
  await page.goBack();
  await expectStage(page, "resume");
  await expect(page.getByTestId(testIds.start.editDestination)).toContainText("京都");
  // 再開したあとも、端末の戻る操作は 1 段ずつ引く
  await page.goBack();
  await expectStage(page, "elapsed");
  await page.goBack();
  await expectStage(page, "cause");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("京都");
  await page.goBack();
  await expectStage(page, "position");
  await page.goBack();
  await expectStage(page, "destination");
});

test("判断が出たあとの端末の戻る操作は、1 回で直前の段に戻る", async ({ page }) => {
  await openEntry(page, false);
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await page.getByTestId(testIds.start.place("osaka")).click();
  await page.getByTestId(testIds.start.line(kobeLine)).click();
  await page.getByTestId(testIds.start.direction(toKobe)).click();
  await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.cause("unknown")).click();
  await page.getByTestId(testIds.start.elapsed("m10")).click();
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  // 判断が届き、地図が描けてから戻る
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.map)).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });

  // 1 回目の戻るで最後に答えた再開見込みの問いに戻り、そのあとは 1 回ごとに 1 段ずつ引く
  await page.goBack();
  await expectStage(page, "resume");
  await expect(page).toHaveURL(/\/$/);
  await page.goBack();
  await expectStage(page, "elapsed");
  await page.goBack();
  await expectStage(page, "cause");
  await page.goBack();
  await expectStage(page, "position");
  await page.goBack();
  await expectStage(page, "destination");
});

test("判断の画面の戻るを押すと、様子の 3 問目に答えを残したまま戻る", async ({ page }) => {
  await openEntry(page);
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await page.getByTestId(testIds.start.place("osaka")).click();
  await page.getByTestId(testIds.start.line(kobeLine)).click();
  await page.getByTestId(testIds.start.direction(toKobe)).click();
  await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.cause("person")).click();
  await page.getByTestId(testIds.start.elapsed("m10")).click();
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });

  // 戻るは上部の帯の左端にあり、判断の更新中でも押せる大きさで見えている
  const back = page.getByTestId(testIds.judgment.backButton);
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute("aria-label", "戻る");
  const box = await back.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(page.getByTestId(testIds.judgment.conclusion)).toBeVisible({ timeout: 30_000 });

  // 押すと様子の 3 問目に戻り、答えた原因と時間のチップが残っている
  await back.click();
  await expect(page).toHaveURL(/\/\?mock=1$/);
  await expectStage(page, "resume");
  await expect(page.getByTestId(testIds.start.answer("cause"))).toContainText("人身事故");
  await expect(page.getByTestId(testIds.start.answer("elapsed"))).toContainText("10分くらい");
  await expect(page.getByTestId(testIds.start.editDestination)).toContainText("三ノ宮");

  // 履歴は二重にならず、端末の戻る操作は 1 回で 1 段引く
  await page.goBack();
  await expectStage(page, "elapsed");
  await expect(page.getByTestId(testIds.start.answer("cause"))).toContainText("人身事故");

  // 選び直して判断を出し、もう一度戻ると、選び直した答えが残っている
  await page.getByTestId(testIds.start.elapsed("m30")).click();
  await page.getByTestId(testIds.start.resume("unknown")).click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await back.click();
  await expectStage(page, "resume");
  await expect(page.getByTestId(testIds.start.answer("elapsed"))).toContainText("30分以上");
});

test("端末の戻る操作でも、入口の段を 1 段ずつ引ける", async ({ page }) => {
  await openEntry(page);
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await page.getByTestId(testIds.start.place("osaka")).click();
  await page.getByTestId(testIds.start.line(kobeLine)).click();
  await page.getByTestId(testIds.start.direction(toKobe)).click();
  await page.getByTestId(testIds.start.destinationCandidate("三ノ宮")).click();
  await page.getByTestId(testIds.start.positionStation).click();
  await page.getByTestId(testIds.start.method("paste")).click();
  await expectStage(page, "input");

  // 選び直しも履歴を引くので、そのあとの戻る操作と食い違わない
  await page.getByTestId(testIds.start.editDestination).click();
  await expectStage(page, "destination");
  for (const stage of ["direction", "station", "area", "kansai"]) {
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
  await expectStage(page, "station");
  await expect(page.getByTestId(testIds.start.place("namba"))).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.goBack();
  await expectStage(page, "area");
});

test("引いた地図はエリアだけを表示し、指で寄る操作でも駅が出る", async ({ page }) => {
  await openEntry(page);
  const map = page.getByTestId(testIds.start.map);
  const places = page.locator("[data-testid^='start-place-']");
  await expect(map).toHaveAttribute("data-detail", "areas");
  await expect(places).toHaveCount(0);
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
  await expectStage(page, "station");
  await expect(page.locator("[data-testid^='start-line-']").first()).toBeVisible();
});

test("京都の地図で私鉄の駅を選び、方面と行き先へ進める", async ({ page }) => {
  await openEntry(page);
  await page.getByTestId(testIds.start.hubEdge("kyoto")).click();
  await expectStage(page, "area");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-detail", "stations");
  await page.getByTestId(testIds.start.place("toji")).click();
  await expectStage(page, "station");
  const line = "東寺|kintetsu.京都線|近鉄京都線";
  await page.getByTestId(testIds.start.line(line)).click();
  await expectStage(page, "direction");
  const south = `${line}>kintetsu.京都線.大和西大寺`;
  await expect(page.getByTestId(testIds.start.direction(south))).toContainText("大和西大寺");
  await page.getByTestId(testIds.start.direction(south)).click();
  await expectStage(page, "destination");
  await expect(page.getByTestId(testIds.start.destinationCandidate("大和西大寺"))).toBeVisible();
});

test("三宮の地図で阪神を選び、利用者向けの方面と行き先が出る", async ({ page }) => {
  await openEntry(page);
  await page.getByTestId(testIds.start.hubEdge("sannomiya")).click();
  await page.getByTestId(testIds.start.place("sannomiya")).click();
  const line = "神戸三宮|hanshin.本線|阪神本線";
  await page.getByTestId(testIds.start.line(line)).click();
  await expectStage(page, "direction");
  const east = `${line}>hanshin.本線.大阪梅田`;
  await expect(page.getByTestId(testIds.start.direction(east))).toContainText("大阪梅田");
  await page.getByTestId(testIds.start.direction(east)).click();
  await expectStage(page, "destination");
  await expect(page.getByTestId(testIds.start.destinationCandidate("大阪梅田"))).toBeVisible();
});

test("位置情報を許可済みなら近くの駅が最初に出て、1回で選べる", async ({ context, page }) => {
  await context.setGeolocation({ latitude: 34.9855, longitude: 135.7585 });
  await context.grantPermissions(["geolocation"]);
  await openEntry(page);
  await expectStage(page, "kansai");
  await page.getByTestId(testIds.start.nearbyStation("京都")).click();
  await expectStage(page, "station");
  await expect(
    page.getByTestId(testIds.start.line("京都|kintetsu.京都線|近鉄京都線")),
  ).toBeVisible();
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

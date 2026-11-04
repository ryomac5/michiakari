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

  // 判断の画面から戻ると、選んだ駅・路線・方面・行き先の状態から再開する
  await page.goBack();
  await expectStage(page, "cause");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("京都");
  // 再開したあとも、端末の戻る操作は 1 段ずつ引く
  await page.goBack();
  await expectStage(page, "position");
  await page.goBack();
  await expectStage(page, "destination");
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

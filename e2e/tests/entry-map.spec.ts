import { expect, type Page, test } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";

// 入口の地図: 関西 → エリア → 駅の順に寄り、戻る操作で 1 段ずつ引ける
// 状況の入力まで同じ画面のシートで続け、最後の一手で判断の画面へ移る

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(90_000);

const kobeLine = "大阪|jr-west.東海道線|JR神戸線";

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
  await expect(
    page.getByTestId(testIds.start.line("大阪|jr-west.東海道線|JR京都線")),
  ).toBeVisible();

  await page.getByTestId(testIds.start.line(kobeLine)).click();
  await expectStage(page, "destination");
  await page.getByTestId(testIds.start.destinationSuggestion("sannomiya")).click();
  await expectStage(page, "method");
  await expect(page.getByTestId(testIds.start.destinationPin)).toBeVisible();
  await page.getByTestId(testIds.start.method("photo")).click();
  await expectStage(page, "input");

  for (const stage of ["method", "destination", "station", "area", "kansai"]) {
    await page.getByTestId(testIds.start.back).click();
    await expectStage(page, stage);
  }
  await expect(page.getByTestId(testIds.start.prompt)).toBeVisible();
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
  await page.getByTestId(testIds.start.line("大阪|jr-west.東海道線|JR京都線")).click();
  await page.getByTestId(testIds.start.destinationSuggestion("sannomiya")).click();
  await expect(page.getByTestId(testIds.start.trip)).toContainText("JR京都線");

  // 行き先は入力の段から選び直せる
  await page.getByTestId(testIds.start.editDestination).click();
  await expectStage(page, "destination");
  await page.getByTestId(testIds.start.destinationSuggestion("kyoto")).click();
  await expect(page.getByTestId(testIds.start.trip)).toContainText("京都");

  await page.getByTestId(testIds.start.method("select")).click();
  await page.locator("[data-testid^='situation-event-type-']").first().click();
  await page.locator("[data-testid^='situation-submit-select']").click();
  await expect(page).toHaveURL(/\/judgment$/, { timeout: 30_000 });
  await expect(page.getByTestId(testIds.judgment.tripSummary)).toContainText("京都");
  // 選んで答える入力は路線を含まない。上部の帯の路線は、入口で選んだ路線から来る
  await expect(page.getByTestId(testIds.judgment.statusChip)).toContainText("JR京都線");

  // 判断の画面から戻ると、選んだ駅・路線・行き先の状態から再開する
  await page.goBack();
  await expectStage(page, "method");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("京都");
  // 再開したあとも、端末の戻る操作は 1 段ずつ引く
  await page.goBack();
  await expectStage(page, "destination");
});

test("端末の戻る操作でも、入口の段を 1 段ずつ引ける", async ({ page }) => {
  await openEntry(page);
  await page.getByTestId(testIds.start.hub("umeda")).click();
  await page.getByTestId(testIds.start.place("osaka")).click();
  await page.getByTestId(testIds.start.line(kobeLine)).click();
  await page.getByTestId(testIds.start.destinationSuggestion("sannomiya")).click();
  await page.getByTestId(testIds.start.method("paste")).click();
  await expectStage(page, "input");

  // 選び直しも履歴を引くので、そのあとの戻る操作と食い違わない
  await page.getByTestId(testIds.start.editDestination).click();
  await expectStage(page, "destination");
  for (const stage of ["station", "area", "kansai"]) {
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

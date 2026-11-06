import type { BrowserContext, Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { expect, test } from "../support/test.ts";

// 入口の最初の段で、端末の位置から いる駅か駅の間 を読み取り、1 回押せば確定できる
// 位置情報を拒否されたら、理由を 1 行出して手で選ぶ流れに戻る

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(90_000);

// JR神戸線の塚本と尼崎の中間。network.json の 2 駅の代表点の中点
const betweenTsukamotoAmagasaki = { latitude: 34.72229, longitude: 135.450335, accuracy: 20 };
// 塚本駅から北東へ 175m。駅の候補には入り、線からは離れている
const nearTsukamoto = { latitude: 34.714091, longitude: 135.469846, accuracy: 10 };

async function openEntry(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId(testIds.start.map)).toHaveAttribute("data-ready", "true", {
    timeout: 30_000,
  });
  await expectStage(page, "position");
}

function expectStage(page: Page, stage: string) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

async function allowLocation(
  context: BrowserContext,
  position: { latitude: number; longitude: number; accuracy: number },
): Promise<void> {
  await context.setGeolocation(position);
  await context.grantPermissions(["geolocation"]);
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "ja", url: baseURL ?? "" }]);
});

test("駅の間にいると路線と 2 駅を尋ね、はいで路線と駅間の段を飛ばして行き先へ進む", async ({
  context,
  page,
}) => {
  await allowLocation(context, betweenTsukamotoAmagasaki);
  await openEntry(page);
  await page.getByTestId(testIds.start.gpsLocate).click();
  await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveText(
    "JR神戸線の塚本〜尼崎の間ですか",
  );
  // 位置の扱いの説明は出さない
  await expect(page.getByText("位置は端末の中で候補を出すだけに使い、送らない。")).toHaveCount(0);
  await page.getByTestId(testIds.start.gpsConfirm).click();

  // 路線・方面・駅間の段を通らずに行き先を聞く
  await expectStage(page, "destination");
  await expect(page.locator("[data-testid^='start-line-']")).toHaveCount(0);
  await expect(page.getByTestId(testIds.start.trainSegment)).toHaveCount(0);

  // 行き先から進む向きを決め、次の駅の尼崎を出発にする
  await page.getByTestId(testIds.start.destinationSearch).fill("さんのみや");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await expectStage(page, "cause");
  await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("JR神戸線");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("尼崎");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("駅と駅の間");

  // 戻ると行き先、その次はいまどこへ戻る
  await page.getByTestId(testIds.start.back).click();
  await expectStage(page, "destination");
  await page.getByTestId(testIds.start.back).click();
  await expectStage(page, "position");
});

test("駅にいると駅名を尋ね、はいで駅を確定して行き先へ進む", async ({ context, page }) => {
  await allowLocation(context, nearTsukamoto);
  await openEntry(page);
  await page.getByTestId(testIds.start.gpsLocate).click();
  await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveText("塚本駅にいますか");
  await page.getByTestId(testIds.start.gpsConfirm).click();

  await expectStage(page, "destination");
  await page.getByTestId(testIds.start.destinationSearch).fill("三ノ宮");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await expectStage(page, "cause");
  await expect(page.getByTestId(testIds.start.routeSummary)).toContainText("JR神戸線");
  await expect(page.getByTestId(testIds.start.trip)).toContainText("塚本");
});

test("位置情報を拒否すると理由を 1 行出し、手で選ぶ流れに戻る", async ({ context, page }) => {
  await context.setGeolocation(nearTsukamoto);
  await context.clearPermissions();
  await openEntry(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Browser.setPermission", {
    permission: { name: "geolocation" },
    setting: "denied",
    origin: new URL(page.url()).origin,
  });
  await page.getByTestId(testIds.start.gpsLocate).click();
  const status = page.getByTestId(testIds.start.gpsStatus);
  await expect(status).toContainText("許可されていない");
  await expect(status).toContainText("地下鉄の地下区間");
  await expect(page.getByTestId(testIds.start.gpsQuestion)).toHaveCount(0);

  // 手で選ぶ札はそのまま使える
  await expectStage(page, "position");
  await page.getByTestId(testIds.start.positionTrain).click();
  await expectStage(page, "station");
});

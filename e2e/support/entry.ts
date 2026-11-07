import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { expect } from "./test.ts";

function expectStage(page: Page, stage: string) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

// 電車の中の人に原因の後で聞く、受信の放送の問いに答える。既定は判断に何も足さない「なかった」
export async function answerProtection(
  page: Page,
  answer: "heard" | "notHeard" | "unsure" = "notHeard",
): Promise<void> {
  await expectStage(page, "protection");
  await page.getByTestId(`start-protection-${answer}`).click();
}

// 駅の間の段で、両側の 2 つの駅名から駅の間を出す。確かめる前で止める
export async function searchStationPair(page: Page, first: string, second: string): Promise<void> {
  await page.getByTestId(testIds.start.betweenFirstSearch).fill(first);
  await page.getByTestId(testIds.start.betweenFirstOption(first)).click();
  await expect(page.getByTestId(testIds.start.betweenFirst)).toHaveText(first);
  await page.getByTestId(testIds.start.betweenSecondSearch).fill(second);
  await page.getByTestId(testIds.start.betweenSecondOption(second)).click();
}

// 最初の段で「駅と駅の間で止まっている」を押し、2 つの駅名で駅の間を選んで行き先の段へ進む
// 並走する路線があれば、line の駅の間を選ぶ
export async function chooseBetweenStations(
  page: Page,
  line: string,
  from: string,
  to: string,
): Promise<void> {
  await page.getByTestId(testIds.start.positionTrain).click();
  await expectStage(page, "between");
  await searchStationPair(page, from, to);
  const question = page.getByTestId(testIds.start.gpsQuestion);
  const choice = page
    .locator("[data-testid^='start-gps-choice-']")
    .filter({ hasText: `${line}の${from}〜${to}の間` });
  await expect(question.or(choice)).toBeVisible();
  if (await question.isVisible()) {
    await expect(question).toHaveText(`${line}の${from}〜${to}の間ですか`);
    await page.getByTestId(testIds.start.gpsConfirm).click();
  } else {
    await choice.click();
  }
  await expectStage(page, "destination");
}

// 乗る電車を選び直す流れで、路線と方面を答えて駅間の段まで進む
// 駅と駅の間で止まっている人が行き先まで答えてから、出発の行を押して選び直す
export async function chooseTrainDirection(
  page: Page,
  lineId: string,
  terminal: string,
): Promise<void> {
  await chooseBetweenStations(page, "JR神戸線", "塚本", "尼崎");
  await page.getByTestId(testIds.start.destinationSearch).fill("三ノ宮");
  await page.getByTestId(testIds.start.destinationOption("三ノ宮")).click();
  await expectStage(page, "cause");
  await page.getByTestId(testIds.start.routeSummary).click();
  await expectStage(page, "station");
  const line = page.locator("[data-testid^='start-line-']").filter({ hasText: lineId });
  await line.first().click();
  await page.locator(`[data-testid^='start-direction-'][data-testid$='.${terminal}']`).click();
  await expectStage(page, "trainPosition");
}

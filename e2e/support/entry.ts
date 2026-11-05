import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { expect } from "./test.ts";

// 車内では駅を選ぶ前に路線と方面を答える。
export async function chooseTrainDirection(
  page: Page,
  lineId: string,
  terminal: string,
): Promise<void> {
  await page.getByTestId(testIds.start.positionTrain).click();
  const line = page.locator("[data-testid^='start-line-']").filter({ hasText: lineId });
  await line.first().click();
  await page.locator(`[data-testid^='start-direction-'][data-testid$='.${terminal}']`).click();
  await expect(page.getByTestId(testIds.start.screen)).toHaveAttribute(
    "data-stage",
    "trainPosition",
  );
}

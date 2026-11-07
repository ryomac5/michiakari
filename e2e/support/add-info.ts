import type { Locator, Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { openSheet } from "./replay.ts";
import { expect } from "./test.ts";

// 判断の画面の「情報を追加する」から、分かったことを 1 つずつ足す
// 入口ではいる所と行き先だけを答え、原因や止まってからの分はここで足す

// 原因の答え。weather は種類まで選ぶ
export type CauseAnswerInput =
  | "person"
  | "inCar"
  | "vehicle"
  | "signaling"
  | "power"
  | "obstruction"
  | "infrastructure"
  | "major_accident"
  | { weather: "rain" | "wind" | "snow" | "lightning" | "earthquake" | "other" };

export type AddInfoAnswers = {
  cause?: CauseAnswerInput;
  protection?: "heard" | "notHeard" | "unsure";
  elapsed?: "now" | "m10" | "m30" | "unknown";
  // 時刻は候補の並びの何番目か。first は最初、last は最後
  resume?: "undecided" | "unknown" | { time: "first" | "second" | "last" };
  ticket?: "ic" | "commuter_pass" | "paper" | "unknown";
};

export async function waitForJudgmentReady(page: Page): Promise<void> {
  await expect(page.getByTestId(testIds.judgment.screen)).toHaveAttribute("data-status", "ready", {
    timeout: 30_000,
  });
}

// 入口で行き先まで答えたあと、判断の画面に移って判断が出るまで待つ
export async function expectJudgmentOpened(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/judgment(\?.*)?$/, { timeout: 30_000 });
  await waitForJudgmentReady(page);
}

// シートを開き、情報を追加するの選んで答えるを出す
export async function openAddInfo(page: Page): Promise<Locator> {
  await openSheet(page, "full");
  const addInfo = page.getByTestId(testIds.judgment.addInfo);
  await addInfo.scrollIntoViewIfNeeded();
  await addInfo.getByTestId(testIds.situation.tab("select")).click();
  return addInfo;
}

async function answerCause(addInfo: Locator, cause: CauseAnswerInput): Promise<void> {
  const known = addInfo.getByTestId(testIds.situation.answer("cause"));
  if (await known.isVisible()) await known.click();
  if (typeof cause === "string") {
    await addInfo.getByTestId(testIds.situation.causeOption(cause)).click();
    return;
  }
  await addInfo.getByTestId(testIds.situation.causeOption("weather")).click();
  await addInfo.getByTestId(testIds.situation.causeKindOption(cause.weather)).click();
}

// 札を押して項目を開く。答え済みなら答えの札、まだなら足せる項目の札を押す
async function openItem(addInfo: Locator, item: string): Promise<void> {
  const answered = addInfo.getByTestId(testIds.situation.answer(item));
  if (await answered.isVisible()) await answered.click();
  else await addInfo.getByTestId(testIds.situation.item(item)).click();
}

async function answerResume(
  addInfo: Locator,
  resume: NonNullable<AddInfoAnswers["resume"]>,
): Promise<string | null> {
  await openItem(addInfo, "resume");
  if (typeof resume === "string") {
    await addInfo.getByTestId(testIds.situation.option("resume", resume)).click();
    return null;
  }
  const times = addInfo.locator("[data-testid^='situation-resume-time-']");
  await expect(times).toHaveCount(8);
  const chosen =
    resume.time === "first"
      ? times.first()
      : resume.time === "second"
        ? times.nth(1)
        : times.last();
  const label = (await chosen.textContent()) ?? "";
  await chosen.click();
  return label;
}

// 答えを 1 つずつ足し、そのたびに判断が出し直されるのを待つ。時刻を選んだら、その表示を返す
export async function addAnswers(page: Page, answers: AddInfoAnswers): Promise<string | null> {
  let resumeLabel: string | null = null;
  const steps: [keyof AddInfoAnswers, (addInfo: Locator) => Promise<void>][] = [
    ["cause", (a) => answerCause(a, answers.cause as CauseAnswerInput)],
    [
      "protection",
      async (a) => {
        await openItem(a, "protection");
        await a
          .getByTestId(testIds.situation.option("protection", answers.protection ?? ""))
          .click();
      },
    ],
    [
      "elapsed",
      async (a) => {
        await openItem(a, "elapsed");
        await a.getByTestId(testIds.situation.option("elapsed", answers.elapsed ?? "")).click();
      },
    ],
    [
      "resume",
      async (a) => {
        resumeLabel = await answerResume(
          a,
          answers.resume as NonNullable<AddInfoAnswers["resume"]>,
        );
      },
    ],
    [
      "ticket",
      async (a) => {
        await openItem(a, "ticket");
        await a.getByTestId(testIds.situation.option("ticket", answers.ticket ?? "")).click();
      },
    ],
  ];
  for (const [key, run] of steps) {
    if (answers[key] === undefined) continue;
    await waitForJudgmentReady(page);
    const addInfo = await openAddInfo(page);
    await run(addInfo);
    await waitForJudgmentReady(page);
  }
  return resumeLabel;
}

// 行き先から向きが決まらなければ方面を聞かれる。聞かれたら terminal で終わる方面を選び、判断が出るまで待つ
export async function expectJudgmentAfterDirection(page: Page, terminal: string): Promise<void> {
  const direction = page.locator(`[data-testid="${testIds.start.screen}"][data-stage="direction"]`);
  await expect(direction.or(page.getByTestId(testIds.judgment.screen))).toBeVisible({
    timeout: 30_000,
  });
  if (await direction.isVisible())
    await page.locator(`[data-testid^='start-direction-'][data-testid$='.${terminal}']`).click();
  await expectJudgmentOpened(page);
}

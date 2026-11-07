import type { Locator, Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import { openSheet } from "./replay.ts";
import { expect } from "./test.ts";

// 入口の問いに答えて判断を出す。判断の画面の「情報を追加する」から、後で分かったことを 1 つずつ足す
// 入口ではいる所と行き先の後に、原因、受信の放送、止まってからの分、乗車券と再開見込みを順に聞く

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

// 行き先から向きが決まらなければ方面を聞かれる。聞かれたら terminal で終わる方面を選び、原因の問いまで進む
export async function chooseDirectionIfAsked(page: Page, terminal?: string): Promise<void> {
  const screen = page.getByTestId(testIds.start.screen);
  await expect(screen).toHaveAttribute("data-stage", /^(cause|direction)$/, { timeout: 30_000 });
  if ((await screen.getAttribute("data-stage")) === "direction") {
    if (!terminal) throw new Error("方面を聞かれたが、選ぶ方面が無い");
    await page.locator(`[data-testid^='start-direction-'][data-testid$='.${terminal}']`).click();
  }
  await expect(screen).toHaveAttribute("data-stage", "cause");
}

function expectEntryStage(page: Page, stage: string | RegExp) {
  return expect(page.getByTestId(testIds.start.screen)).toHaveAttribute("data-stage", stage);
}

// 入口の原因の問いから最後の問いまで答え、判断の画面で判断が出るまで待つ
// 答えない問いは分からないを押す。受信の放送は車内の人にだけ聞く。乗車券は再開見込みの問いの上で選ぶ
// 時刻を選んだら、その表示を返す
export async function finishEntry(
  page: Page,
  answers: AddInfoAnswers = {},
): Promise<string | null> {
  await expectEntryStage(page, "cause");
  const cause = answers.cause;
  if (cause === undefined) await page.getByTestId(testIds.start.cause("unknown")).click();
  else if (typeof cause === "string") await page.getByTestId(testIds.start.cause(cause)).click();
  else {
    await page.getByTestId(testIds.start.cause("weather")).click();
    await expectEntryStage(page, "causeKind");
    await page.getByTestId(testIds.start.causeKind(cause.weather)).click();
  }
  await expectEntryStage(page, /^(protection|elapsed)$/);
  const screen = page.getByTestId(testIds.start.screen);
  if ((await screen.getAttribute("data-stage")) === "protection") {
    await page.getByTestId(`start-protection-${answers.protection ?? "unsure"}`).click();
    await expectEntryStage(page, "elapsed");
  }
  await page.getByTestId(testIds.start.elapsed(answers.elapsed ?? "unknown")).click();
  await expectEntryStage(page, "resume");
  if (answers.ticket) await page.getByTestId(testIds.start.ticket(answers.ticket)).click();
  let label: string | null = null;
  const resume = answers.resume ?? "unknown";
  if (typeof resume === "string") await page.getByTestId(testIds.start.resume(resume)).click();
  else {
    await page.getByTestId(testIds.start.resume("stated")).click();
    const times = page.locator("[data-testid^='start-resume-time-']");
    await expect(times).toHaveCount(8);
    const chosen =
      resume.time === "first"
        ? times.first()
        : resume.time === "second"
          ? times.nth(1)
          : times.last();
    label = (await chosen.textContent()) ?? "";
    await chosen.click();
  }
  await expectJudgmentOpened(page);
  return label;
}

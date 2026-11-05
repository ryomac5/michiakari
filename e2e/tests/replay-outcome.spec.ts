/// <reference lib="dom" />
// page 内で動かす関数（evaluate）のために DOM の型を読む
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { testIds } from "../../apps/web/src/features/judgment/testids.ts";
import {
  compareReplayOutcome,
  getFirstTrainWait,
  type ReplayDecision,
  type ReplayOutcome,
} from "../../packages/core/src/index.ts";
import type { Judgment } from "../../packages/schema/src/judgment.ts";
import {
  findRepoRoot,
  loadKnowledgeDir,
  resolveContentDir,
} from "../../packages/schema/src/loaders.ts";
import { resolveDeadline } from "../../packages/schema/src/scenario.ts";
import { contentDir } from "../servers.ts";
import { loadReplayScenarios, openReplay, waitForFiniteAnimations } from "../support/replay.ts";
import { expect, test } from "../support/test.ts";

// リプレイの結末（デモ台本 2:35〜3:00）
// ground_truth のあるシナリオをすべて最後まで流し、結末のカードの値が core の計算と一致することを確かめる
// シナリオ ID と期待値はコードに書かず、YAML と agent の応答から求める

const screenshotDir = fileURLToPath(new URL("../screenshots/", import.meta.url));
const testSpeed = 60;
const scenarios = loadReplayScenarios().filter(
  (s) => s.ground_truth.resume_offset_minutes !== null,
);
const knowledge = loadKnowledgeDir(
  join(resolveContentDir({ CONTENT_DIR: contentDir }, findRepoRoot()), "knowledge"),
).entries.map((entry) => entry.data);

type RecordedJudgment = { now: string; judgment: Judgment };

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
test.setTimeout(180_000);

// POST /judge の応答（SSE）を page 内で複製して読み、確定した判断を要求の now と組にして記録する
// 画面の読み取りとは別の複製を読むので、再生の動きは変わらない
async function recordJudgments(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: { now: string; body: string }[] = [];
    const pending: Promise<void>[] = [];
    Object.assign(window, { __judgeLog: log, __judgePending: pending });
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (init?.method === "POST" && new URL(url).pathname.endsWith("/judge")) {
        const now = (JSON.parse(String(init.body)) as { now: string }).now;
        pending.push(
          response
            .clone()
            .text()
            .then((body) => {
              log.push({ now, body });
            }),
        );
      }
      return response;
    };
  });
}

async function readJudgments(page: Page): Promise<RecordedJudgment[]> {
  const log = await page.evaluate(async () => {
    const w = window as unknown as {
      __judgeLog: { now: string; body: string }[];
      __judgePending: Promise<void>[];
    };
    await Promise.all(w.__judgePending);
    return w.__judgeLog;
  });
  return log.flatMap(({ now, body }) => {
    const ready = body
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5)) as { type: string; judgment?: Judgment })
      .find((event) => event.type === "judgment_ready");
    return ready?.judgment ? [{ now, judgment: ready.judgment }] : [];
  });
}

function earliestArrival(options: readonly Judgment["options"][number][]): string | null {
  const sorted = options.map((o) => o.arrivalTime).sort((a, b) => Date.parse(a) - Date.parse(b));
  return sorted[0] ?? null;
}

// 切り替えた場合の比較先。分岐点と同じ規則で、公共交通のうち最も早い到着を取る
// 公共交通が期限に間に合わず、タクシーなら間に合うときだけタクシーを取る。公共交通が無ければタクシーにする
function pickAlternativeArrival(
  options: readonly Judgment["options"][number][],
  deadline: string | null,
): string | null {
  const rail = earliestArrival(options.filter((o) => o.kind === "transfer" || o.kind === "walk"));
  const taxi = earliestArrival(options.filter((o) => o.kind === "taxi"));
  if (rail === null) return taxi;
  if (taxi === null || deadline === null) return rail;
  const limit = Date.parse(deadline);
  return Date.parse(rail) > limit && Date.parse(taxi) <= limit ? taxi : rail;
}

// 判断 1 件を結末の計算に渡す形にする。画面の実装とは独立に、応答の値から組み立てる
function toDecision({ now, judgment }: RecordedJudgment, deadline: string | null): ReplayDecision {
  const recommended = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
  const rideLegs =
    judgment.options.find((o) => o.kind === "wait")?.legs.filter((l) => l.mode !== "wait") ?? [];
  return {
    observedAt: now,
    action: judgment.action,
    recommendedArrival: recommended?.arrivalTime ?? null,
    waitRideMinutesAfterResume:
      rideLegs.length === 0 ? null : rideLegs.reduce((total, l) => total + l.minutes, 0),
    bestAlternativeArrival: pickAlternativeArrival(judgment.options, deadline),
  };
}

function findFirstTrainWait(recorded: readonly RecordedJudgment[]): number {
  const eventType = recorded.findLast((r) => r.judgment.estimate.eventType !== null)?.judgment
    .estimate.eventType;
  const found = knowledge.find((k) => k.id === eventType);
  return found ? getFirstTrainWait(found).p50 : 0;
}

// 列に表示した到着時刻。列の中で最後に出る HH:MM が到着である
async function readArrivalClock(page: Page, testId: string): Promise<string> {
  const text = (await page.getByTestId(testId).textContent()) ?? "";
  const clock = text.match(/\d{2}:\d{2}/g)?.at(-1);
  if (!clock) throw new Error(`${testId} に到着時刻がありません`);
  return clock;
}

function toClockMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatJstClock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Tokyo",
  }).format(new Date(iso));
}

// 要約の文が語る相手と分が、2 列に並べた相手と表示の時刻の差に一致する
async function expectSummaryMatchesColumns(
  page: Page,
  locale: "ja" | "en",
  expected: ReplayOutcome,
): Promise<void> {
  const summary = (await page.getByTestId(testIds.replay.outcomeSummary).textContent()) ?? "";
  const followedClock = await readArrivalClock(page, testIds.replay.outcomeFollowed);
  const counterpartClock = await readArrivalClock(page, testIds.replay.outcomeCounterpart);
  const shownDiff =
    ((toClockMinutes(counterpartClock) - toClockMinutes(followedClock) + 2160) % 1440) - 720;
  expect(shownDiff, "2 列の時刻の差").toBe(expected.diffMinutes);
  if (expected.diffMinutes !== 0) {
    expect(followedClock).not.toBe(counterpartClock);
    const minutes = Math.abs(expected.diffMinutes);
    expect(summary).toContain(locale === "ja" ? `${minutes}分` : `${minutes} min`);
  }
  const counterpart = page.getByTestId(testIds.replay.outcomeCounterpart);
  if (expected.counterpart.switchedAt === null) {
    await expect(counterpart).toContainText(locale === "ja" ? "待ち続けた人" : "Kept waiting");
    expect(summary).toMatch(locale === "ja" ? /待ち続け/ : /wait/i);
    return;
  }
  const switchedClock = formatJstClock(expected.counterpart.switchedAt);
  await expect(counterpart).toContainText(locale === "ja" ? "切り替えた人" : "Switched instead");
  await expect(counterpart).toContainText(switchedClock);
  expect(summary).toContain(
    locale === "ja" ? `${switchedClock} に切り替え` : `switching at ${switchedClock}`,
  );
}

test("ground_truth のあるシナリオが 1 本以上ある", () => {
  expect(scenarios.length).toBeGreaterThan(0);
});

for (const scenario of scenarios) {
  for (const locale of ["ja", "en"] as const) {
    test(`シナリオ ${scenario.id}（${locale}）: 最後まで流すと結末のカードが出て、値が core の計算と一致する`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: baseURL ?? "" }]);
      await recordJudgments(page);
      await openReplay(page, scenario.id, testSpeed);
      await expect(page.getByTestId(testIds.replay.outcome)).toHaveCount(0);

      await page.getByTestId(testIds.replay.playButton).click();
      await expect(page.getByTestId(testIds.replay.screen)).toHaveAttribute("data-state", "ended", {
        timeout: 120_000,
      });

      const recorded = (await readJudgments(page)).sort(
        (a, b) => Date.parse(a.now) - Date.parse(b.now),
      );
      expect(recorded.map((r) => r.now)).toHaveLength(scenario.timeline.length);
      const deadline = scenario.user.constraints.deadline
        ? resolveDeadline(scenario.start_time, scenario.user.constraints.deadline)
        : null;
      const expected = compareReplayOutcome({
        decisions: recorded.map((r) => toDecision(r, deadline)),
        resumeOffsetMinutes: scenario.ground_truth.resume_offset_minutes,
        startTime: scenario.start_time,
        firstTrainWaitMinutes: findFirstTrainWait(recorded),
        deadline,
      });
      expect(expected, "core の計算で結末を求められる").not.toBeNull();
      if (!expected) return;

      const card = page.getByTestId(testIds.replay.outcome);
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute("data-followed-arrival", expected.followed.arrival);
      await expect(card).toHaveAttribute("data-counterpart-arrival", expected.counterpart.arrival);
      await expect(card).toHaveAttribute(
        "data-counterpart-switched-at",
        expected.counterpart.switchedAt ?? "",
      );
      await expect(card).toHaveAttribute("data-diff-minutes", String(expected.diffMinutes));
      await expect(card).toHaveAttribute("data-verdict", expected.verdict);
      await expect(page.getByTestId(testIds.replay.outcomeFollowed)).toHaveAttribute(
        "data-on-time",
        expected.followed.deadline ? String(expected.followed.deadline.onTime) : "",
      );
      await expect(page.getByTestId(testIds.replay.outcomeCounterpart)).toHaveAttribute(
        "data-on-time",
        expected.counterpart.deadline ? String(expected.counterpart.deadline.onTime) : "",
      );
      await expectSummaryMatchesColumns(page, locale, expected);
      // 架空であることと、推定であることの注記
      await expect(card).toContainText(
        locale === "ja" ? "すべて架空のシナリオです" : "All scenarios are fictional",
      );
      await expect(card).toContainText(
        locale === "ja" ? "推定であり、公式発表を優先してください" : "Estimate only",
      );

      // 終わるとシートが半分まで開き、390x844 の画面に結末のカードが収まる
      await expect(page.getByTestId(testIds.judgment.sheet)).toHaveAttribute("data-snap", "half");
      await waitForFiniteAnimations(page);
      const box = await card.boundingBox();
      expect(box, "結末のカードの位置").not.toBeNull();
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
      // 2 列の中身が列の幅からはみ出さない
      for (const id of [testIds.replay.outcomeFollowed, testIds.replay.outcomeCounterpart]) {
        const clipped = await page
          .getByTestId(id)
          .evaluate((el) =>
            [el, ...el.querySelectorAll("*")].some((c) => c.scrollWidth > c.clientWidth),
          );
        expect(clipped, `${id} の中身がはみ出している`).toBe(false);
      }
      await page.screenshot({
        path: `${screenshotDir}replay-outcome-${scenario.id}-${locale}-390x844.png`,
      });

      // PC 幅でも横にはみ出さない
      await page.setViewportSize({ width: 1280, height: 900 });
      await waitForFiniteAnimations(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await card.screenshot({
        path: `${screenshotDir}replay-outcome-${scenario.id}-${locale}-1280-card.png`,
      });
    });
  }
}

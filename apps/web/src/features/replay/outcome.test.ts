import { compareReplayOutcome, type ReplayOutcome } from "@repo/core";
import type { Judgment, Observation } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  buildPersonAccidentEvents,
  personAccidentCatalog,
} from "@/features/judgment/fixtures/person-accident";
import { buildTestRequest } from "@/features/judgment/test-helpers";
import { buildReplayDecision, selectOutcomeSummary, selectReplayOutcome } from "./outcome";
import type { ReplayScenario } from "./scenario";

function pickJudgment(followUp: boolean, now: string): Judgment {
  const observations = followUp ? [{} as Observation] : [];
  const events = buildPersonAccidentEvents(buildTestRequest({ now, observations }));
  const ready = events.find((e) => e.type === "judgment_ready");
  if (ready?.type !== "judgment_ready") throw new Error("判断がありません");
  return ready.judgment;
}

const scenario: ReplayScenario = {
  id: "test",
  title: { ja: "テスト" },
  event_type: "person_accident",
  operator: "架空鉄道",
  line: "架空線",
  blocked_section: { from_station: "大阪", to_station: "三ノ宮" },
  start_time: "2026-11-05T22:10:00+09:00",
  user: {
    current_station: "大阪",
    destination: "三ノ宮",
    constraints: { deadline: "00:25", knows_alternatives: false, mobility_notes: null },
    language: "ja",
  },
  timeline: [],
  resumeOffsetMinutes: 90,
};

describe("buildReplayDecision", () => {
  it("推奨した選択肢の到着、待つ選択肢の乗車分、最も早い代替の到着を取り出す", () => {
    const judgment = pickJudgment(true, "2026-11-05T22:40:00+09:00");
    const decision = buildReplayDecision(judgment, "2026-11-05T22:40:00+09:00");
    const recommended = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
    const wait = judgment.options.find((o) => o.kind === "wait");
    const rideMinutes = wait?.legs
      .filter((l) => l.mode !== "wait")
      .reduce((total, l) => total + l.minutes, 0);

    expect(decision.action).toBe(judgment.action);
    expect(decision.recommendedArrival).toBe(recommended?.arrivalTime ?? null);
    expect(decision.waitRideMinutesAfterResume).toBe(rideMinutes ?? null);
    expect(decision.eventType).toBe(judgment.estimate.eventType);
  });

  it("待つ選択肢に乗車の区間が無ければ乗車分は null", () => {
    const judgment = pickJudgment(false, "2026-11-05T22:10:00+09:00");
    const unrouted: Judgment = {
      ...judgment,
      options: [
        {
          id: "wait",
          kind: "wait",
          label: "待つ",
          legs: [{ mode: "wait", from: "大阪", to: "大阪", minutes: 30 }],
          arrivalTime: "2026-11-05T22:40:00+09:00",
          fareYen: null,
          walkMinutes: 0,
          isTransferService: false,
        },
      ],
      recommendedOptionId: null,
    };
    const decision = buildReplayDecision(unrouted, "2026-11-05T22:10:00+09:00");
    expect(decision.waitRideMinutesAfterResume).toBeNull();
    expect(decision.bestAlternativeArrival).toBeNull();
  });
});

describe("selectReplayOutcome", () => {
  it("記録した判断と知見の初列車待ちで core の計算を呼ぶ", () => {
    const decisions = [
      buildReplayDecision(
        pickJudgment(false, "2026-11-05T22:10:00+09:00"),
        "2026-11-05T22:10:00+09:00",
      ),
      buildReplayDecision(
        pickJudgment(true, "2026-11-05T22:40:00+09:00"),
        "2026-11-05T22:40:00+09:00",
      ),
    ];
    const firstTrainWait = personAccidentCatalog[0]?.firstTrainWaitMinutes ?? 0;
    expect(selectReplayOutcome(scenario, decisions, personAccidentCatalog)).toEqual(
      compareReplayOutcome({
        decisions,
        resumeOffsetMinutes: 90,
        startTime: scenario.start_time,
        firstTrainWaitMinutes: firstTrainWait,
        deadline: "2026-11-06T00:25:00+09:00",
      }),
    );
  });

  it("正解が無いシナリオや判断が無いときは null", () => {
    const decisions = [
      buildReplayDecision(
        pickJudgment(false, "2026-11-05T22:10:00+09:00"),
        "2026-11-05T22:10:00+09:00",
      ),
    ];
    expect(
      selectReplayOutcome(
        { ...scenario, resumeOffsetMinutes: null },
        decisions,
        personAccidentCatalog,
      ),
    ).toBeNull();
    expect(selectReplayOutcome(scenario, [], personAccidentCatalog)).toBeNull();
  });
});

describe("selectOutcomeSummary", () => {
  const base: ReplayOutcome = {
    resumedAt: "2026-11-05T23:40:00+09:00",
    switchedAt: "2026-11-05T22:45:00+09:00",
    followedArrival: "2026-11-05T23:58:00+09:00",
    waitedArrival: "2026-11-06T00:30:00+09:00",
    diffMinutes: 32,
    followedDeadline: { onTime: true, marginMinutes: 27 },
    waitedDeadline: { onTime: false, marginMinutes: -5 },
    firstAlternativeArrival: null,
    alternativeDiffMinutes: null,
    verdict: "followed_earlier",
  };

  it("従った人だけが期限に間に合えば、要約の一文に期限を含める", () => {
    expect(selectOutcomeSummary(base)).toEqual({
      key: "followedEarlierMadeIt",
      minutes: 32,
      deadlineKey: null,
    });
  });

  it("期限が無ければ期限の文を付けない", () => {
    expect(selectOutcomeSummary({ ...base, followedDeadline: null, waitedDeadline: null })).toEqual(
      { key: "followedEarlier", minutes: 32, deadlineKey: null },
    );
  });

  it("待つほうが早い場合と差が小さい場合は文言を変える", () => {
    expect(
      selectOutcomeSummary({
        ...base,
        diffMinutes: -12,
        verdict: "waited_earlier",
        followedDeadline: { onTime: false, marginMinutes: -2 },
        waitedDeadline: { onTime: true, marginMinutes: 10 },
      }),
    ).toEqual({ key: "waitedEarlier", minutes: 12, deadlineKey: "waitedOnly" });
    expect(
      selectOutcomeSummary({
        ...base,
        diffMinutes: 3,
        verdict: "about_same",
        waitedDeadline: { onTime: true, marginMinutes: 24 },
      }),
    ).toEqual({ key: "aboutSame", minutes: 3, deadlineKey: "both" });
  });

  it("最後まで待つ判断なら、最初に切り替えた場合との差で待つ判断の正しさを示す", () => {
    const waited = {
      ...base,
      switchedAt: null,
      followedArrival: base.waitedArrival,
      diffMinutes: 0,
      followedDeadline: { onTime: true, marginMinutes: 30 },
      waitedDeadline: { onTime: true, marginMinutes: 30 },
      verdict: "never_switched" as const,
    };
    expect(
      selectOutcomeSummary({
        ...waited,
        firstAlternativeArrival: "2026-11-06T00:45:00+09:00",
        alternativeDiffMinutes: 15,
      }),
    ).toEqual({ key: "waitWon", minutes: 15, deadlineKey: "sameOnTime" });
    expect(selectOutcomeSummary(waited)).toEqual({
      key: "neverSwitched",
      minutes: 0,
      deadlineKey: "sameOnTime",
    });
  });

  it("最後まで待つ判断で、最初に切り替えたほうが十分早ければ外れたことを示す", () => {
    const waited = {
      ...base,
      switchedAt: null,
      followedArrival: base.waitedArrival,
      diffMinutes: 0,
      followedDeadline: null,
      waitedDeadline: null,
      verdict: "never_switched" as const,
      firstAlternativeArrival: "2026-11-05T23:50:00+09:00",
    };
    expect(selectOutcomeSummary({ ...waited, alternativeDiffMinutes: -40 })).toEqual({
      key: "switchWouldWin",
      minutes: 40,
      deadlineKey: null,
    });
    // 差が小さければ外れとは言わない
    expect(selectOutcomeSummary({ ...waited, alternativeDiffMinutes: -1 }).key).toBe(
      "neverSwitched",
    );
  });
});

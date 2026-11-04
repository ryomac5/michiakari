import { compareReplayOutcome, type ReplayOutcome } from "@repo/core";
import type { Judgment, Observation } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  buildPersonAccidentEvents,
  personAccidentCatalog,
} from "@/features/judgment/fixtures/person-accident";
import { buildTestRequest } from "@/features/judgment/test-helpers";
import { formatClockTime } from "@/features/judgment/time";
import ja from "../../../messages/ja.json";
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

  it("最も早い代替の到着は、公共交通があればタクシーより公共交通から取る", () => {
    const judgment = pickJudgment(false, "2026-11-05T22:10:00+09:00");
    const wait = judgment.options.find((o) => o.kind === "wait");
    if (!wait) throw new Error("待つ選択肢がありません");
    const option = (id: string, kind: "transfer" | "taxi", arrivalTime: string) => ({
      ...wait,
      id,
      kind,
      label: id,
      legs: [
        {
          mode: kind === "taxi" ? ("taxi" as const) : ("ride" as const),
          from: "大阪",
          to: "三ノ宮",
          minutes: 30,
        },
      ],
      arrivalTime,
    });
    const withTaxi: Judgment = {
      ...judgment,
      options: [
        wait,
        option("detour", "transfer", "2026-11-06T00:10:00+09:00"),
        option("taxi", "taxi", "2026-11-05T22:50:00+09:00"),
      ],
    };
    expect(buildReplayDecision(withTaxi, "2026-11-05T22:10:00+09:00").bestAlternativeArrival).toBe(
      "2026-11-06T00:10:00+09:00",
    );
    const taxiOnly: Judgment = {
      ...judgment,
      options: [wait, option("taxi", "taxi", "2026-11-05T22:50:00+09:00")],
    };
    expect(buildReplayDecision(taxiOnly, "2026-11-05T22:10:00+09:00").bestAlternativeArrival).toBe(
      "2026-11-05T22:50:00+09:00",
    );

    // 期限に鉄道の代替が間に合わず、タクシーなら間に合うときだけ、タクシーの到着を取る。core の決まりと同じ
    const late = (deadline: string | null) =>
      buildReplayDecision(withTaxi, "2026-11-05T22:10:00+09:00", deadline).bestAlternativeArrival;
    expect(late("2026-11-06T00:25:00+09:00")).toBe("2026-11-06T00:10:00+09:00");
    expect(late("2026-11-05T23:00:00+09:00")).toBe("2026-11-05T22:50:00+09:00");
    expect(late("2026-11-05T22:30:00+09:00")).toBe("2026-11-06T00:10:00+09:00");
    expect(late(null)).toBe("2026-11-06T00:10:00+09:00");
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
  const waitedTraveler = {
    switchedAt: null,
    arrival: "2026-11-06T00:30:00+09:00",
    deadline: { onTime: false, marginMinutes: -5 },
  };
  const base: ReplayOutcome = {
    resumedAt: "2026-11-05T23:40:00+09:00",
    followed: {
      switchedAt: "2026-11-05T22:45:00+09:00",
      arrival: "2026-11-05T23:58:00+09:00",
      deadline: { onTime: true, marginMinutes: 27 },
    },
    counterpart: waitedTraveler,
    diffMinutes: 32,
    verdict: "followed_earlier",
  };
  // 待つ判断に従った人を、18:20 に切り替えた人と比べる
  const waitAdvice: ReplayOutcome = {
    resumedAt: "2026-11-09T18:27:00+09:00",
    followed: { switchedAt: null, arrival: "2026-11-09T18:41:00+09:00", deadline: null },
    counterpart: {
      switchedAt: "2026-11-09T18:20:00+09:00",
      arrival: "2026-11-09T18:50:00+09:00",
      deadline: null,
    },
    diffMinutes: 9,
    verdict: "followed_earlier",
  };

  it("従った人だけが期限に間に合えば、要約の一文に期限を含める", () => {
    expect(selectOutcomeSummary(base)).toEqual({
      key: "followedEarlierMadeIt",
      minutes: 32,
      counterpartSwitchedAt: null,
      deadlineKey: null,
    });
  });

  it("期限が無ければ期限の文を付けない", () => {
    expect(
      selectOutcomeSummary({
        ...base,
        followed: { ...base.followed, deadline: null },
        counterpart: { ...waitedTraveler, deadline: null },
      }),
    ).toEqual({
      key: "followedEarlier",
      minutes: 32,
      counterpartSwitchedAt: null,
      deadlineKey: null,
    });
  });

  it("待つほうが早い場合と差が小さい場合は文言を変える", () => {
    expect(
      selectOutcomeSummary({
        ...base,
        followed: { ...base.followed, deadline: { onTime: false, marginMinutes: -2 } },
        counterpart: { ...waitedTraveler, deadline: { onTime: true, marginMinutes: 10 } },
        diffMinutes: -12,
        verdict: "counterpart_earlier",
      }),
    ).toMatchObject({ key: "waitedEarlier", minutes: 12, deadlineKey: "waitedOnly" });
    expect(
      selectOutcomeSummary({
        ...base,
        counterpart: { ...waitedTraveler, deadline: { onTime: true, marginMinutes: 24 } },
        diffMinutes: 3,
        verdict: "about_same",
      }),
    ).toMatchObject({ key: "aboutSame", minutes: 3, deadlineKey: "both" });
  });

  it("待つ判断なら、切り替えた人と比べた差で待つ判断の正しさを示す", () => {
    expect(selectOutcomeSummary(waitAdvice)).toEqual({
      key: "waitWon",
      minutes: 9,
      counterpartSwitchedAt: "2026-11-09T18:20:00+09:00",
      deadlineKey: null,
    });
    expect(
      selectOutcomeSummary({ ...waitAdvice, diffMinutes: -40, verdict: "counterpart_earlier" }),
    ).toMatchObject({ key: "switchWouldWin", minutes: 40 });
    // 差が小さければ外れとも当たりとも言わない
    expect(
      selectOutcomeSummary({ ...waitAdvice, diffMinutes: -1, verdict: "about_same" }),
    ).toMatchObject({ key: "waitAboutSame", minutes: 1 });
  });

  it("待つ判断で期限があれば、切り替えた人との間に合いを比べる", () => {
    expect(
      selectOutcomeSummary({
        ...waitAdvice,
        followed: { ...waitAdvice.followed, deadline: { onTime: false, marginMinutes: -3 } },
        counterpart: {
          ...waitAdvice.counterpart,
          deadline: { onTime: true, marginMinutes: 6 },
        },
        diffMinutes: -9,
        verdict: "counterpart_earlier",
      }).deadlineKey,
    ).toBe("switchedOnly");
  });

  it("待つ判断で代替手段が無ければ、待ち続けた人と同じ時刻に着いたと示す", () => {
    const same: ReplayOutcome = {
      ...waitAdvice,
      counterpart: waitAdvice.followed,
      diffMinutes: 0,
      verdict: "about_same",
    };
    expect(selectOutcomeSummary(same)).toEqual({
      key: "neverSwitched",
      minutes: 0,
      counterpartSwitchedAt: null,
      deadlineKey: null,
    });
  });
});

// 要約の文が、カードに並べる 2 人と同じ相手・同じ差を語っているか
describe("結末の要約とカードの 2 列の一致", () => {
  const summaries = ja.replay.outcome.summary;
  const clockMinutes = (iso: string) => {
    const [h, m] = formatClockTime(iso, "ja").split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  // 2 列に表示する時刻の差（分）。日付をまたいでも ±12 時間の範囲に収める
  const displayedGap = (outcome: ReplayOutcome) =>
    ((clockMinutes(outcome.counterpart.arrival) - clockMinutes(outcome.followed.arrival) + 2160) %
      1440) -
    720;

  const cases: [string, ReplayOutcome][] = [
    [
      "切り替えの判断と、待ち続けた人",
      compareOrThrow({
        decisions: [
          {
            observedAt: "2026-11-05T22:10:00+09:00",
            action: "switch",
            recommendedArrival: "2026-11-05T23:58:00+09:00",
            waitRideMinutesAfterResume: 40,
            bestAlternativeArrival: "2026-11-05T23:58:00+09:00",
          },
        ],
        resumeOffsetMinutes: 90,
        startTime: "2026-11-05T22:10:00+09:00",
        firstTrainWaitMinutes: 10,
        deadline: "2026-11-06T00:25:00+09:00",
      }),
    ],
    [
      "待つ判断と、最初に切り替えた人",
      compareOrThrow({
        decisions: [
          {
            observedAt: "2026-11-09T18:20:00+09:00",
            action: "wait",
            recommendedArrival: "2026-11-09T18:41:00+09:00",
            waitRideMinutesAfterResume: 14,
            bestAlternativeArrival: "2026-11-09T18:50:00+09:00",
          },
        ],
        resumeOffsetMinutes: 7,
        startTime: "2026-11-09T18:20:00+09:00",
        firstTrainWaitMinutes: 0,
        deadline: null,
      }),
    ],
  ];

  for (const [name, outcome] of cases) {
    it(`${name}: 文の相手の言葉と差の分が、2 列の見出しと時刻の差に一致する`, () => {
      const summary = selectOutcomeSummary(outcome);
      const template = summaries[summary.key];
      expect(outcome.followed.arrival).not.toBe(outcome.counterpart.arrival);
      expect(displayedGap(outcome)).toBe(outcome.diffMinutes);
      expect(summary.minutes).toBe(Math.abs(displayedGap(outcome)));
      expect(template).toContain("{minutes}分");
      if (outcome.counterpart.switchedAt === null) {
        expect(template).toContain("待ち続け");
        expect(ja.replay.outcome.waited).toBe("待ち続けた人");
      } else {
        expect(template).toContain(`{time} に${ja.replay.outcome.switched}`);
        expect(summary.counterpartSwitchedAt).toBe(outcome.counterpart.switchedAt);
      }
    });
  }
});

function compareOrThrow(input: Parameters<typeof compareReplayOutcome>[0]): ReplayOutcome {
  const outcome = compareReplayOutcome(input);
  if (!outcome) throw new Error("結末がありません");
  return outcome;
}

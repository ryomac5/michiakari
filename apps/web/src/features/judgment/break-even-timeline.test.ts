import { resolveFirstTrainWait } from "@repo/core";
import type { JudgmentEvent } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  buildBreakEvenTimeline,
  classifyResumeRelation,
  computeResumeWindow,
  estimateFirstTrainWait,
  listTicks,
  selectTimelineBasis,
} from "./break-even-timeline";
import { buildPersonAccidentEvents } from "./fixtures/person-accident";
import {
  createJudgmentState,
  type JudgmentState,
  reduceJudgmentState,
  selectJudgmentDisplay,
  startJudgmentRun,
} from "./state";
import { buildTestRequest } from "./test-helpers";

const events = buildPersonAccidentEvents(buildTestRequest());
function applyEvents(state: JudgmentState, list: JudgmentEvent[]): JudgmentState {
  return list.reduce(reduceJudgmentState, state);
}

const at = (clock: string) => `2026-11-05T${clock}:00+09:00`;
const ms = (clock: string) => Date.parse(at(clock));

describe("computeResumeWindow", () => {
  it("基準時刻に乗れるまでの残りを足し、初列車待ちを引く", () => {
    const window = computeResumeWindow(at("22:45"), { p50: 65, p80: 80 }, 10);
    expect(window).toEqual({ p50Ms: ms("23:40"), p80Ms: ms("23:55") });
  });

  it("基準時刻より前にはしない", () => {
    const window = computeResumeWindow(at("22:45"), { p50: 5, p80: 20 }, 10);
    expect(window).toEqual({ p50Ms: ms("22:45"), p80Ms: ms("22:55") });
  });
});

describe("classifyResumeRelation", () => {
  it("帯が分岐点より前・またぐ・後を見分ける", () => {
    const be = ms("23:06");
    expect(classifyResumeRelation({ p50Ms: ms("22:50"), p80Ms: ms("23:05") }, be)).toBe("before");
    expect(classifyResumeRelation({ p50Ms: ms("22:50"), p80Ms: ms("23:06") }, be)).toBe("before");
    expect(classifyResumeRelation({ p50Ms: ms("23:00"), p80Ms: ms("23:20") }, be)).toBe("straddle");
    expect(classifyResumeRelation({ p50Ms: ms("23:06"), p80Ms: ms("23:20") }, be)).toBe("straddle");
    expect(classifyResumeRelation({ p50Ms: ms("23:07"), p80Ms: ms("23:20") }, be)).toBe("after");
  });
});

describe("listTicks", () => {
  it("日本時間の区切りに合わせ、多すぎない間隔を選ぶ", () => {
    expect(listTicks(ms("22:41"), ms("23:29"))).toEqual(
      ["22:50", "23:00", "23:10", "23:20"].map(ms),
    );
    expect(listTicks(ms("22:41"), ms("00:10") + 86_400_000)).toEqual(
      ["22:45", "23:00", "23:15", "23:30", "23:45"].map(ms).concat([ms("00:00") + 86_400_000]),
    );
  });
});

describe("buildBreakEvenTimeline", () => {
  it("見込みが分岐点を越えると after になり、越えた区間だけを bandAfter にする", () => {
    const timeline = buildBreakEvenTimeline({
      asOf: at("22:45"),
      now: new Date(at("22:45")),
      breakEvenTime: at("23:23"),
      remaining: { p50: 65, p80: 80 },
      firstTrainWaitMinutes: 10,
      deadline: null,
    });
    expect(timeline.relation).toBe("after");
    expect(timeline.bandBefore).toBeNull();
    expect(timeline.bandAfter?.from).toBeCloseTo(timeline.positions.resumeP50);
    expect(timeline.positions.breakEven).toBeLessThan(timeline.positions.resumeP50);
    expect(timeline.positions.now).toBeLessThan(timeline.positions.breakEven);
  });

  it("帯が分岐点をまたぐと、前後の区間を分岐点で分ける", () => {
    const timeline = buildBreakEvenTimeline({
      asOf: at("23:05"),
      now: new Date(at("23:05")),
      breakEvenTime: at("23:44"),
      remaining: { p50: 45, p80: 60 },
      firstTrainWaitMinutes: 10,
      deadline: null,
    });
    expect(timeline.relation).toBe("straddle");
    expect(timeline.bandBefore?.to).toBeCloseTo(timeline.positions.breakEven);
    expect(timeline.bandAfter?.from).toBeCloseTo(timeline.positions.breakEven);
  });

  it("期限も軸に収め、位置はすべて 0〜1 に入る", () => {
    const timeline = buildBreakEvenTimeline({
      asOf: at("22:32"),
      now: new Date(at("22:40")),
      breakEvenTime: at("23:06"),
      remaining: { p50: 28, p80: 43 },
      firstTrainWaitMinutes: 10,
      deadline: `2026-11-06T00:25:00+09:00`,
    });
    expect(timeline.relation).toBe("before");
    expect(timeline.bandAfter).toBeNull();
    const { now, breakEven, resumeP50, resumeP80, deadline } = timeline.positions;
    for (const p of [now, breakEven, resumeP50, resumeP80, deadline ?? -1]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(deadline).toBeGreaterThan(resumeP80);
    expect(timeline.ticks.length).toBeGreaterThan(0);
  });
});

describe("期限と判断からの値の選び方", () => {
  it("遠すぎる期限は軸に入れない", () => {
    const timeline = buildBreakEvenTimeline({
      asOf: at("20:00"),
      now: new Date(at("20:00")),
      breakEvenTime: at("20:30"),
      remaining: { p50: 20, p80: 40 },
      firstTrainWaitMinutes: 10,
      deadline: at("23:59"),
    });
    expect(timeline.positions.deadline).toBeNull();
  });

  it("分岐点と残り時間があるときだけ図の値を作り、初列車待ちは core の規則表から引く", () => {
    const ready = applyEvents(startJudgmentRun(createJudgmentState()), events);
    const display = selectJudgmentDisplay(ready);
    const judgment = display.settled?.judgment;
    if (!judgment) throw new Error("判断がありません");
    expect(selectTimelineBasis(display.settled, null)).toEqual({
      asOf: display.settled?.at,
      breakEvenTime: judgment.breakEven?.time,
      remaining: judgment.estimate.remaining,
      firstTrainWaitMinutes: estimateFirstTrainWait(judgment.estimate.eventType),
      deadline: null,
      action: judgment.action,
    });
    expect(estimateFirstTrainWait("person_collision")).toBe(
      resolveFirstTrainWait("person_collision").p50,
    );
    expect(estimateFirstTrainWait("medical_response")).toBe(
      resolveFirstTrainWait("medical_response").p50,
    );
    expect(estimateFirstTrainWait("unknown_event")).toBe(resolveFirstTrainWait(null).p50);
    expect(estimateFirstTrainWait(null)).toBe(resolveFirstTrainWait(null).p50);
    const noRemaining = {
      at: at("22:00"),
      judgment: { ...judgment, estimate: { ...judgment.estimate, remaining: null } },
    };
    expect(selectTimelineBasis(noRemaining, null)).toBeNull();
    expect(selectTimelineBasis(null, null)).toBeNull();
  });
});

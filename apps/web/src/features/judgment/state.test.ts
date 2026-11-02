import type { JudgmentEvent, Observation } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { buildPersonAccidentEvents } from "./fixtures/person-accident";
import {
  createJudgmentState,
  type JudgmentState,
  mergeObservations,
  reduceJudgmentState,
  selectJudgmentDisplay,
  startJudgmentRun,
} from "./state";
import { buildTestRequest } from "./test-helpers";

function applyEvents(state: JudgmentState, events: JudgmentEvent[]): JudgmentState {
  return events.reduce(reduceJudgmentState, state);
}

function findEvent<T extends JudgmentEvent["type"]>(events: JudgmentEvent[], type: T) {
  const found = events.find((e) => e.type === type);
  if (!found) throw new Error(`fixture に ${type} がありません`);
  return found as Extract<JudgmentEvent, { type: T }>;
}

const events = buildPersonAccidentEvents(buildTestRequest());

describe("reduceJudgmentState", () => {
  it("開始時は読み取りだけが進行中になる", () => {
    const state = startJudgmentRun(createJudgmentState());
    expect(state.status).toBe("streaming");
    expect(state.steps).toEqual({
      reading: "active",
      signals: "pending",
      phase: "pending",
      options: "pending",
      breakEven: "pending",
    });
  });

  it("イベントの到着に合わせて推論の各段を順に進める", () => {
    const start = startJudgmentRun(createJudgmentState());
    const afterObservation = applyEvents(start, [findEvent(events, "observation_parsed")]);
    expect(afterObservation.steps.reading).toBe("done");
    expect(afterObservation.steps.signals).toBe("active");
    expect(afterObservation.observations).toHaveLength(1);

    const signalEvents = events.filter((e) => e.type === "signal_detected");
    const afterSignals = applyEvents(afterObservation, signalEvents);
    expect(afterSignals.signals).toHaveLength(signalEvents.length);
    expect(afterSignals.steps.signals).toBe("active");

    const afterPhase = applyEvents(afterSignals, [findEvent(events, "phase_estimated")]);
    expect(afterPhase.steps).toMatchObject({ signals: "done", phase: "done", options: "active" });
    expect(afterPhase.estimate?.phaseId).toBe("on_site");

    const afterOptions = applyEvents(afterPhase, [findEvent(events, "alternatives_computed")]);
    expect(afterOptions.steps).toMatchObject({ options: "done", breakEven: "active" });
    expect(afterOptions.options).toHaveLength(3);

    const afterBreakEven = applyEvents(afterOptions, [findEvent(events, "break_even_computed")]);
    expect(afterBreakEven.breakEvenComputed).toBe(true);
    expect(afterBreakEven.steps.breakEven).toBe("done");
    expect(afterBreakEven.status).toBe("streaming");
  });

  it("judgment_ready で結論を確定し、すべての段を完了にする", () => {
    const state = applyEvents(startJudgmentRun(createJudgmentState()), events);
    expect(state.status).toBe("ready");
    expect(state.judgment?.action).toBe("wait");
    expect(Object.values(state.steps).every((s) => s === "done")).toBe(true);
  });

  it("観測が無くても段階の推定で前の段を完了にする", () => {
    const start = startJudgmentRun(createJudgmentState());
    const state = applyEvents(start, [findEvent(events, "phase_estimated")]);
    expect(state.steps).toMatchObject({ reading: "done", signals: "done", phase: "done" });
  });

  it("error で状態を error にし、進行中の段を中断にする", () => {
    const start = startJudgmentRun(createJudgmentState());
    const state = reduceJudgmentState(start, {
      type: "error",
      seq: 0,
      at: "2026-11-05T22:40:00+09:00",
      message: "boom",
      retryable: true,
    });
    expect(state.status).toBe("error");
    expect(state.error).toEqual({ message: "boom", retryable: true });
    expect(state.steps.reading).toBe("failed");
  });

  it("seq が前回以下のイベントは捨てる", () => {
    const first = findEvent(events, "observation_parsed");
    const once = reduceJudgmentState(startJudgmentRun(createJudgmentState()), first);
    expect(reduceJudgmentState(once, first)).toBe(once);
  });

  it("同じ兆候は二重に追加しない", () => {
    const signal = findEvent(events, "signal_detected");
    const state = applyEvents(startJudgmentRun(createJudgmentState()), [
      signal,
      { ...signal, seq: signal.seq + 10 },
    ]);
    expect(state.signals).toHaveLength(1);
  });
});

describe("selectJudgmentDisplay", () => {
  it("更新中はまだ届いていない項目を前回の判断で補い、古い印を付ける", () => {
    const ready = applyEvents(startJudgmentRun(createJudgmentState()), events);
    const rerun = startJudgmentRun(ready);
    const display = selectJudgmentDisplay(rerun);

    expect(rerun.judgment).toBeNull();
    expect(display.options).toEqual(ready.judgment?.options);
    expect(display.optionsStale).toBe(true);
    expect(display.breakEven).toEqual(ready.judgment?.breakEven);
    expect(display.breakEvenStale).toBe(true);
    expect(display.recommendedOptionId).toBe("wait_resume");
  });

  it("新しい値が届いたらそちらを使う", () => {
    const ready = applyEvents(startJudgmentRun(createJudgmentState()), events);
    const rerun = applyEvents(startJudgmentRun(ready), [
      { type: "break_even_computed", seq: 0, at: "2026-11-05T22:41:00+09:00", breakEven: null },
    ]);
    const display = selectJudgmentDisplay(rerun);
    expect(display.breakEven).toBeNull();
    expect(display.breakEvenKnown).toBe(true);
    expect(display.breakEvenStale).toBe(false);
  });

  it("初回の生成中は分岐点も選択肢も未確定として扱う", () => {
    const display = selectJudgmentDisplay(startJudgmentRun(createJudgmentState()));
    expect(display.options).toBeNull();
    expect(display.breakEvenKnown).toBe(false);
    expect(display.optionsStale).toBe(false);
  });
});

describe("mergeObservations", () => {
  it("新しい観測を末尾に足し、同じ id は置き換える", () => {
    const base = findEvent(events, "observation_parsed").observation;
    const a: Observation = { ...base, id: "a" };
    const b: Observation = { ...base, id: "b" };
    const a2: Observation = { ...base, id: "a", rawText: "更新" };
    expect(mergeObservations([a], [b]).map((o) => o.id)).toEqual(["a", "b"]);
    expect(mergeObservations([a, b], [a2])).toEqual([b, a2]);
  });
});

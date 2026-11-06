import type { Observation } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { selectStoppedPlace, selectStopScope } from "./stop-scope";

// 止まり方の区別と、上部の帯に出す止まった場所

function buildObservation(eventType: string | null): Observation {
  return {
    id: "obs",
    observedAt: "2026-11-05T22:00:00+09:00",
    source: "selection",
    eventTypeCandidates: eventType ? [{ eventType, confidence: "high" }] : [],
    operator: null,
    line: "JR神戸線",
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
  };
}

describe("selectStopScope", () => {
  it("車内の急病人や非常ボタンはその列車だけが止まり、人身事故は区間を止める", () => {
    expect(selectStopScope("in_car_response", [])).toBe("train");
    expect(selectStopScope("person_accident", [])).toBe("section");
  });

  it("判断の推定がまだ無ければ、新しい観測の第一候補で決める。候補が無ければ区間を止めるとみなす", () => {
    expect(selectStopScope(null, [buildObservation("in_car_response")])).toBe("train");
    expect(
      selectStopScope(undefined, [buildObservation("in_car_response"), buildObservation(null)]),
    ).toBe("train");
    expect(selectStopScope(null, [buildObservation(null)])).toBe("section");
  });
});

describe("selectStoppedPlace", () => {
  const base = {
    nextStation: null,
    previousStation: null,
    trainsAhead: null,
    trainsAheadCount: null,
    ownTrainType: null,
  };

  it("駅間なら駅の間、駅に止まった車内なら駅名、駅で待つ人なら場所を出さない", () => {
    expect(
      selectStoppedPlace(
        { ...base, kind: "between_stations", previousStation: "福島", nextStation: "大阪" },
        "大阪",
      ),
    ).toEqual({ kind: "between", from: "福島", to: "大阪" });
    expect(selectStoppedPlace({ ...base, kind: "on_train_at_station" }, "大阪")).toEqual({
      kind: "station",
      name: "大阪",
    });
    expect(selectStoppedPlace({ ...base, kind: "at_station" }, "大阪")).toBeNull();
    expect(selectStoppedPlace(null, "大阪")).toBeNull();
  });
});

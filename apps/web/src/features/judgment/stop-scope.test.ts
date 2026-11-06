import type { IncidentCause, Observation } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { selectStoppedPlace, selectStopScope } from "./stop-scope";

// 止まり方の区別と、上部の帯に出す止まった場所

function buildObservation(
  eventType: string | null,
  section: Observation["section"] = null,
): Observation {
  return {
    id: "obs",
    observedAt: "2026-11-05T22:00:00+09:00",
    source: "selection",
    eventTypeCandidates: eventType ? [{ eventType, confidence: "high" }] : [],
    operator: null,
    line: "JR神戸線",
    section,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
  };
}

// 知見のある事象。エージェントの知見と同じく、候補はこの中だけから選ぶ
const known = new Set(["in_car_response", "person_accident", "vehicle_failure", "heavy_rain"]);
const isKnownEvent = (id: string) => known.has(id);

function select(
  estimatedEventType: string | null | undefined,
  observations: readonly Observation[],
  cause: IncidentCause | null = null,
  isKnown: (id: string) => boolean = isKnownEvent,
) {
  return selectStopScope({ estimatedEventType, observations, cause, isKnownEvent: isKnown });
}

describe("selectStopScope", () => {
  it("車内の急病人や非常ボタンはその列車だけが止まり、人身事故は区間を止める", () => {
    expect(select("in_car_response", [])).toBe("train");
    expect(select("person_accident", [])).toBe("section");
  });

  it("判断の推定がまだ無ければ、観測の候補から事象を選ぶ。候補が無ければ区間を止めるとみなす", () => {
    expect(select(null, [buildObservation("in_car_response")])).toBe("train");
    expect(select(undefined, [buildObservation("in_car_response"), buildObservation(null)])).toBe(
      "train",
    );
    expect(select(null, [buildObservation(null)])).toBe("section");
  });

  it("知見の無い観測の候補は、エージェントと同じく使わず、入口の原因で決める", () => {
    const person = { group: "passenger", type: "person_collision" };
    expect(
      select(null, [buildObservation("in_car_response")], person, (id) => id !== "in_car_response"),
    ).toBe("section");
  });

  it("候補は確信度で重みづけして選び、新しい観測の第一候補だけでは決めない", () => {
    const observations: Observation[] = [
      { ...buildObservation("person_accident"), id: "a" },
      { ...buildObservation("person_accident"), id: "b" },
      {
        ...buildObservation(null),
        id: "c",
        eventTypeCandidates: [{ eventType: "in_car_response", confidence: "low" }],
      },
    ];
    expect(select(null, observations)).toBe("section");
  });

  it("車両の故障はその列車から止まり、発表に区間が出るまでは区間の見合わせとしない", () => {
    expect(select("vehicle_failure", [])).toBe("train");
    expect(
      select("vehicle_failure", [
        buildObservation("vehicle_failure", { fromStation: "大阪", toStation: "尼崎" }),
      ]),
    ).toBe("section");
  });

  it("事象が無ければ入口の原因で決める", () => {
    expect(select(null, [], { group: "signaling", type: null })).toBe("train");
    expect(select(null, [], { group: "passenger", type: "person_collision" })).toBe("section");
    expect(select(null, [], null)).toBe("section");
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

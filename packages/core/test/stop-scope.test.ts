import type { Observation } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { INCIDENT_TYPE_IDS } from "../params/incident-durations.ts";
import {
  resolveObservedStopScope,
  resolveStopKind,
  resolveStopScope,
  selectObservedEventType,
} from "../src/index.ts";

describe("resolveStopKind", () => {
  it("車内の対応はその列車だけが止まる", () => {
    expect(resolveStopKind("in_car_response", null)).toBe("train_only");
    expect(resolveStopKind(null, { group: "passenger", type: "medical_response" })).toBe(
      "train_only",
    );
    expect(resolveStopKind(null, { group: "passenger", type: "passenger_conflict" })).toBe(
      "train_only",
    );
  });

  it("車両の故障と発煙、信号や保安装置、ポイントの不具合は、その列車から止まる", () => {
    expect(resolveStopKind("vehicle_failure", null)).toBe("train_first");
    for (const type of ["vehicle_failure", "vehicle_smoke"]) {
      expect(resolveStopKind(null, { group: "vehicle", type })).toBe("train_first");
    }
    for (const type of ["signal_failure", "point_failure"]) {
      expect(resolveStopKind(null, { group: "signaling", type })).toBe("train_first");
    }
  });

  it("種類を聞かない大分類は、中の種類がみな同じ止まり方ならそれを使う", () => {
    expect(resolveStopKind(null, { group: "vehicle", type: null })).toBe("train_first");
    expect(resolveStopKind(null, { group: "signaling", type: null })).toBe("train_first");
    // 人・旅客対応は種類で止まり方が違うので、区間とみなす
    expect(resolveStopKind(null, { group: "passenger", type: null })).toBe("section");
    expect(resolveStopKind(null, { group: "obstruction", type: null })).toBe("section");
  });

  it("人との接触、気象、地震、分からない種類は区間が止まる", () => {
    expect(resolveStopKind("person_accident", null)).toBe("section");
    expect(resolveStopKind("heavy_rain", null)).toBe("section");
    for (const type of [
      "person_collision",
      "track_intrusion",
      "crossing_obstruction",
      "strong_wind",
      "earthquake",
      "power_outage",
      "lightning",
      "snow_ice",
      "heat_rail_deformation",
      "derailment",
    ]) {
      expect(resolveStopKind(null, { group: "weather", type })).toBe("section");
    }
    expect(resolveStopKind(null, null)).toBe("section");
    expect(resolveStopKind("unknown_event", null)).toBe("section");
  });

  it("知見の事象を入口の原因より先に使う", () => {
    expect(resolveStopKind("person_accident", { group: "vehicle", type: null })).toBe("section");
    expect(resolveStopKind(null, { group: "vehicle", type: null })).toBe("train_first");
  });

  it("すべての種類に止まり方がある", () => {
    for (const type of INCIDENT_TYPE_IDS) {
      expect(["train_only", "train_first", "section"]).toContain(
        resolveStopKind(null, { group: "x", type }),
      );
    }
  });
});

describe("resolveStopScope", () => {
  it("その列車だけが止まる種類は、発表に区間があっても停車中とする", () => {
    expect(resolveStopScope({ eventType: "in_car_response" })).toBe("train");
    expect(resolveStopScope({ eventType: "in_car_response", sectionAnnounced: true })).toBe(
      "train",
    );
  });

  it("その列車から止まる故障は、発表に区間が出るまで停車中とし、出たら区間とする", () => {
    expect(resolveStopScope({ eventType: "vehicle_failure" })).toBe("train");
    expect(resolveStopScope({ cause: { group: "signaling", type: null } })).toBe("train");
    expect(resolveStopScope({ eventType: "vehicle_failure", sectionAnnounced: true })).toBe(
      "section",
    );
  });

  it("区間が止まる種類と、分からない原因は区間とする", () => {
    expect(resolveStopScope({ eventType: "person_accident" })).toBe("section");
    expect(resolveStopScope({ cause: { group: "weather", type: "strong_wind" } })).toBe("section");
    expect(resolveStopScope({})).toBe("section");
  });
});

describe("resolveObservedStopScope", () => {
  const observe = (eventType: string, confidence: "high" | "low"): Observation => ({
    id: eventType,
    observedAt: "2026-11-05T22:00:00+09:00",
    source: "text",
    eventTypeCandidates: [{ eventType, confidence }],
    operator: null,
    line: null,
    section: null,
    statedResumeTime: null,
    transferServiceActive: null,
    detectedSignals: [],
  });

  it("知見の無い候補は数えず、入口の原因で決める", () => {
    expect(
      resolveObservedStopScope({
        observations: [observe("in_car_response", "high")],
        isKnownEvent: () => false,
        cause: { group: "passenger", type: "person_collision" },
      }),
    ).toBe("section");
  });

  it("候補は確信度で重みづけして選ぶ", () => {
    const observations = [observe("person_accident", "high"), observe("in_car_response", "low")];
    expect(selectObservedEventType(observations, () => true)).toBe("person_accident");
    expect(resolveObservedStopScope({ observations, isKnownEvent: () => true })).toBe("section");
  });
});

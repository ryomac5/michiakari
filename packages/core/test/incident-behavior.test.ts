import { describe, expect, it } from "vitest";
import {
  FIRST_TRAIN_WAIT_BY_STOP_KIND,
  INCIDENT_BEHAVIOR,
  INCIDENT_BEHAVIOR_SOURCE,
} from "../params/incident-behavior.ts";
import { INCIDENT_TYPE_IDS } from "../params/incident-durations.ts";
import { STOP_KIND_BY_INCIDENT_TYPE } from "../src/index.ts";

describe("INCIDENT_BEHAVIOR", () => {
  it("すべての種類に規則があり、出典は開発者の推定", () => {
    expect(Object.keys(INCIDENT_BEHAVIOR).sort()).toEqual([...INCIDENT_TYPE_IDS].sort());
    expect(INCIDENT_BEHAVIOR_SOURCE).toBe("開発者の推定");
  });

  it("規則 1: 防護無線を出す事象、出すかもしれない事象、出さない事象を分ける", () => {
    const always = INCIDENT_TYPE_IDS.filter((t) => INCIDENT_BEHAVIOR[t].protection === "always");
    expect(always.sort()).toEqual(
      [
        "person_collision",
        "track_intrusion",
        "crossing_obstruction",
        "track_structure_damage",
        "building_falling_object",
        "track_smoke_check",
        "crossing_collision",
        "derailment",
        "onboard_fire",
      ].sort(),
    );
    const maybe = INCIDENT_TYPE_IDS.filter((t) => INCIDENT_BEHAVIOR[t].protection === "maybe");
    expect(maybe.sort()).toEqual(
      ["vegetation_obstruction", "foreign_object", "animal_collision", "bridge_impact"].sort(),
    );
    expect(INCIDENT_BEHAVIOR.medical_response.protection).toBe("none");
    expect(INCIDENT_BEHAVIOR.heavy_rain.protection).toBe("none");
  });

  it("規則 1: 車内ブザーはその列車だけ、故障はその列車から、大雨は区間が止まる", () => {
    expect(INCIDENT_BEHAVIOR.medical_response.stopKind).toBe("train_only");
    expect(INCIDENT_BEHAVIOR.passenger_conflict.stopKind).toBe("train_only");
    expect(INCIDENT_BEHAVIOR.vehicle_failure.stopKind).toBe("train_first");
    expect(INCIDENT_BEHAVIOR.point_failure.stopKind).toBe("train_first");
    expect(INCIDENT_BEHAVIOR.heavy_rain.stopKind).toBe("section");
    expect(INCIDENT_BEHAVIOR.earthquake.stopKind).toBe("section");
  });

  it("止まり方の表は規則表から引き、初列車待ちは止まり方の値と一致する", () => {
    for (const t of INCIDENT_TYPE_IDS) {
      const b = INCIDENT_BEHAVIOR[t];
      expect(STOP_KIND_BY_INCIDENT_TYPE[t]).toBe(b.stopKind);
      expect(b.firstTrainWait).toEqual(FIRST_TRAIN_WAIT_BY_STOP_KIND[b.stopKind]);
    }
  });

  it("規則 6: 短く終わる事象の目安を持つ", () => {
    expect(INCIDENT_BEHAVIOR.medical_response.ruleRange).toEqual({ p50: 5, p80: 15 });
    expect(INCIDENT_BEHAVIOR.passenger_conflict.ruleRange).toEqual({ p50: 5, p80: 15 });
    expect(INCIDENT_BEHAVIOR.track_intrusion.ruleRange).toEqual({ p50: 10, p80: 30 });
    expect(INCIDENT_BEHAVIOR.suspicious_object.ruleRange).toEqual({ p50: 10, p80: 30 });
    const withRange = INCIDENT_TYPE_IDS.filter((t) => INCIDENT_BEHAVIOR[t].ruleRange !== null);
    for (const t of withRange) expect(INCIDENT_BEHAVIOR[t].flowOutlook).toBe("short");
  });

  it("規則 7: 衝突、脱線、車内の発火はとても長く、めったに無い事象は分からないとする", () => {
    expect(INCIDENT_BEHAVIOR.crossing_collision.flowOutlook).toBe("very_long");
    expect(INCIDENT_BEHAVIOR.derailment.flowOutlook).toBe("very_long");
    expect(INCIDENT_BEHAVIOR.onboard_fire.flowOutlook).toBe("very_long");
    expect(INCIDENT_BEHAVIOR.vehicle_failure.flowOutlook).toBe("long");
    expect(INCIDENT_BEHAVIOR.heavy_rain.flowOutlook).toBe("long");
    expect(INCIDENT_BEHAVIOR.lightning).toMatchObject({ flowOutlook: "unknown", rare: true });
  });
});

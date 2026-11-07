import { describe, expect, it } from "vitest";
import {
  checkProtectionIncident,
  checkWeatherIncident,
  decideRuleConfidence,
  findIncidentTypeByPhrase,
  resolveFirstTrainWait,
  resolveFlowOutlook,
  resolveIncidentType,
} from "../src/index.ts";

describe("resolveIncidentType", () => {
  it("事象、入口の原因、発表の呼び名の順に決める", () => {
    expect(resolveIncidentType({ eventType: "person_accident" })).toBe("person_collision");
    expect(resolveIncidentType({ eventType: "derailment" })).toBe("derailment");
    expect(resolveIncidentType({ cause: { group: "passenger", type: "medical_response" } })).toBe(
      "medical_response",
    );
    expect(resolveIncidentType({ texts: ["", "大雨のため見合わせ"] })).toBe("heavy_rain");
    expect(resolveIncidentType({ eventType: "unknown_event", texts: ["遅れています"] })).toBeNull();
  });

  it("呼び名は長いほうを選ぶ", () => {
    expect(findIncidentTypeByPhrase("踏切で車と衝突したため")).toBe("crossing_collision");
    expect(findIncidentTypeByPhrase("車両から煙が出たため")).toBe("vehicle_smoke");
    expect(findIncidentTypeByPhrase("車両故障のため")).toBe("vehicle_failure");
  });
});

describe("resolveFlowOutlook と resolveFirstTrainWait", () => {
  it("規則 7: 種類の長さの見込みを引き、分からなければ unknown", () => {
    expect(resolveFlowOutlook("derailment")).toBe("very_long");
    expect(resolveFlowOutlook("signal_failure")).toBe("long");
    expect(resolveFlowOutlook("medical_response")).toBe("short");
    expect(resolveFlowOutlook(null)).toBe("unknown");
  });

  it("初列車待ちは止まり方で決まり、分からなければ区間の値", () => {
    expect(resolveFirstTrainWait("medical_response")).toEqual({ p50: 2, p80: 5 });
    expect(resolveFirstTrainWait("vehicle_failure")).toEqual({ p50: 5, p80: 15 });
    expect(resolveFirstTrainWait(null)).toEqual(resolveFirstTrainWait("heavy_rain"));
  });
});

describe("checkWeatherIncident", () => {
  it("天気の大分類だけ true", () => {
    expect(checkWeatherIncident("strong_wind")).toBe(true);
    expect(checkWeatherIncident("earthquake")).toBe(true);
    expect(checkWeatherIncident("person_collision")).toBe(false);
    expect(checkWeatherIncident(null)).toBe(false);
  });
});

describe("checkProtectionIncident", () => {
  it("規則 1: 必ず出す種類は true、車内ブザーと故障は false", () => {
    expect(checkProtectionIncident({ type: "person_collision", cues: [] })).toBe(true);
    expect(checkProtectionIncident({ type: "track_intrusion", cues: [] })).toBe(true);
    expect(checkProtectionIncident({ type: "medical_response", cues: [] })).toBe(false);
    expect(checkProtectionIncident({ type: "vehicle_failure", cues: [] })).toBe(false);
  });

  it("規則 2: 原因が分からなくても受信の手がかりで true", () => {
    expect(checkProtectionIncident({ type: null, cues: ["protection_received"] })).toBe(true);
    expect(checkProtectionIncident({ type: null, cues: [] })).toBe(false);
  });

  it("出すかもしれない種類は受信の手がかりで決める", () => {
    expect(checkProtectionIncident({ type: "animal_collision", cues: [] })).toBe(false);
    expect(
      checkProtectionIncident({ type: "animal_collision", cues: ["protection_received"] }),
    ).toBe(true);
  });
});

describe("decideRuleConfidence", () => {
  it("再開と延びていない発表は高い", () => {
    expect(decideRuleConfidence({ type: null, basis: "resumed", cues: [] })).toBe("high");
    expect(decideRuleConfidence({ type: null, basis: "stated", cues: [] })).toBe("high");
    expect(
      decideRuleConfidence({ type: null, basis: "stated", cues: [], statedExtended: true }),
    ).toBe("medium");
  });

  it("規則の目安は中、統計値は再開が近い手がかりがあれば中", () => {
    expect(decideRuleConfidence({ type: "medical_response", basis: "rule", cues: [] })).toBe(
      "medium",
    );
    expect(decideRuleConfidence({ type: "heavy_rain", basis: "statistics", cues: [] })).toBe("low");
    expect(
      decideRuleConfidence({ type: "heavy_rain", basis: "statistics", cues: ["resume_soon"] }),
    ).toBe("medium");
    expect(decideRuleConfidence({ type: null, basis: null, cues: [] })).toBe("low");
  });
});

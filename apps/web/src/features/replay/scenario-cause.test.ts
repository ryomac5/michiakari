import { describe, expect, it } from "vitest";
import { findScenarioCause, selectCauseLabelKey } from "./scenario-cause";

describe("findScenarioCause", () => {
  it("シナリオの事象を入口の原因の表の答えにする", () => {
    expect(findScenarioCause("person_accident")).toEqual({ category: "passenger", kind: "person" });
    expect(findScenarioCause("heavy_rain")).toEqual({ category: "weather", kind: "rain" });
    expect(findScenarioCause("medical_response")).toEqual({ category: "passenger", kind: "inCar" });
    expect(findScenarioCause("strong_wind")).toEqual({ category: "weather", kind: "wind" });
    expect(findScenarioCause("unknown_event")).toBeNull();
  });
});

describe("selectCauseLabelKey", () => {
  it("種類を聞いた答えは種類の呼び名、ほかは最初の選択肢の呼び名を使う", () => {
    expect(selectCauseLabelKey({ category: "weather", kind: "rain" })).toBe("causeKinds.rain");
    expect(selectCauseLabelKey({ category: "passenger", kind: "person" })).toBe("causes.person");
    expect(selectCauseLabelKey({ category: "vehicle", kind: null })).toBe("causes.vehicle");
    expect(selectCauseLabelKey({ category: null, kind: null })).toBeNull();
  });
});

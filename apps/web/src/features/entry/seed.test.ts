import { ObservationSchema } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { buildLineObservation } from "./seed";

describe("buildLineObservation", () => {
  it("選んだ路線を、事象の種類を持たない観測にする", () => {
    const observation = buildLineObservation(
      {
        key: "大阪|jr-west.東海道線|JR神戸線",
        lineId: "jr-west.東海道線",
        stationName: "大阪",
        observedName: "JR神戸線",
        name: { ja: "JR神戸線", en: "JR Kobe Line" },
        operator: { ja: "JR西日本", en: "JR West" },
        color: "#0072BC",
      },
      new Date("2026-11-03T05:00:00Z"),
    );
    expect(ObservationSchema.parse(observation)).toEqual(observation);
    expect(observation.line).toBe("JR神戸線");
    expect(observation.eventTypeCandidates).toEqual([]);
    expect(observation.observedAt).toBe("2026-11-03T14:00:00+09:00");
  });
});

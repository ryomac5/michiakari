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

  it("止まってからの分が分かれば、見た時刻をその分だけ前にする", () => {
    const line = {
      key: "心斎橋|osaka-metro.御堂筋線|地下鉄御堂筋線",
      lineId: "osaka-metro.御堂筋線",
      stationName: "心斎橋",
      observedName: "地下鉄御堂筋線",
      name: { ja: "地下鉄御堂筋線", en: "Midosuji Line" },
      operator: { ja: "Osaka Metro", en: "Osaka Metro" },
      color: "#E5171F",
    };
    const now = new Date("2026-11-03T05:00:00Z");
    expect(buildLineObservation(line, now, 15).observedAt).toBe("2026-11-03T13:45:00+09:00");
    expect(buildLineObservation(line, now, null).observedAt).toBe("2026-11-03T14:00:00+09:00");
  });

  it("放送で聞いた再開見込みの時刻があれば、発表された見込みとして載せる", () => {
    const line = {
      key: "心斎橋|osaka-metro.御堂筋線|地下鉄御堂筋線",
      lineId: "osaka-metro.御堂筋線",
      stationName: "心斎橋",
      observedName: "地下鉄御堂筋線",
      name: { ja: "地下鉄御堂筋線", en: "Midosuji Line" },
      operator: { ja: "Osaka Metro", en: "Osaka Metro" },
      color: "#E5171F",
    };
    const now = new Date("2026-11-03T05:00:00Z");
    const stated = "2026-11-03T14:30:00+09:00";
    const observation = buildLineObservation(line, now, 10, stated);
    expect(ObservationSchema.parse(observation)).toEqual(observation);
    expect(observation.statedResumeTime).toBe(stated);
    expect(buildLineObservation(line, now, 10).statedResumeTime).toBeNull();
  });
});

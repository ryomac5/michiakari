import { describe, expect, it } from "vitest";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";
import {
  elapsedOptions,
  findElapsedOption,
  listCauseOptions,
  listResumeTimeOptions,
} from "./plain-questions";

// 放送の原因の選択肢は、知見にある事象だけを出す

function buildCatalog(ids: string[]): KnowledgeCatalog {
  return ids.map((id) => ({ id, name: { ja: id }, phases: [] }));
}

describe("listCauseOptions", () => {
  it("車内対応の知見があれば、人身事故の次に決まった言葉で出す", () => {
    const options = listCauseOptions(
      buildCatalog(["heavy_rain", "in_car_response", "person_accident", "vehicle_failure"]),
    );
    expect(options.map((o) => o.id)).toEqual(["person", "inCar", "vehicle", "rain"]);
    expect(options.find((o) => o.id === "inCar")?.eventType).toBe("in_car_response");
  });

  it("知見に無い事象の選択肢は出さず、決まった言葉に無い知見は名前で出す", () => {
    const options = listCauseOptions(buildCatalog(["person_accident", "strong_wind"]));
    expect(options).toEqual([
      { kind: "preset", id: "person", eventType: "person_accident" },
      { kind: "knowledge", id: "strong_wind", eventType: "strong_wind" },
    ]);
  });
});

describe("elapsedOptions", () => {
  it("いま止まったは 0 分、分からないは null で、id から引ける", () => {
    expect(elapsedOptions.map((o) => [o.id, o.minutes])).toEqual([
      ["now", 0],
      ["m10", 10],
      ["m30", 30],
      ["unknown", null],
    ]);
    expect(findElapsedOption("m10").minutes).toBe(10);
    expect(findElapsedOption("unknown").minutes).toBeNull();
  });
});

describe("listResumeTimeOptions", () => {
  it("いまを 10 分刻みに切り上げ、10 分おきに 8 つ並べる", () => {
    const times = listResumeTimeOptions(new Date(2026, 10, 4, 22, 47, 30));
    expect(times.map((t) => t.id)).toEqual([
      "2250",
      "2300",
      "2310",
      "2320",
      "2330",
      "2340",
      "2350",
      "0000",
    ]);
    expect(times[0]?.iso.startsWith("2026-11-04T22:50:00")).toBe(true);
    expect(times[7]?.iso.startsWith("2026-11-05T00:00:00")).toBe(true);
  });

  it("ちょうど 10 分の時刻なら、次の 10 分から並べる", () => {
    const times = listResumeTimeOptions(new Date(2026, 10, 4, 22, 50, 0));
    expect(times[0]?.id).toBe("2300");
  });
});

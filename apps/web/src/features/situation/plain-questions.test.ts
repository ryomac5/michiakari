import { describe, expect, it } from "vitest";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";
import { listCauseOptions } from "./plain-questions";

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

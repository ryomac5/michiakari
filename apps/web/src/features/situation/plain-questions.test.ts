import { describe, expect, it } from "vitest";
import { elapsedOptions, findElapsedOption, listResumeTimeOptions } from "./plain-questions";

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

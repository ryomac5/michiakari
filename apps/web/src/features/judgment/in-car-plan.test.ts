import { describe, expect, it } from "vitest";
import { selectInCarPlan } from "./in-car-plan";

// 車内の人に勧める動きを、案内と行き先から決める

const stay = {
  alightStation: "天満",
  alightArrival: "2026-11-07T20:12:00+09:00",
  departure: "2026-11-07T20:10:00+09:00",
  departureP80: "2026-11-07T20:20:00+09:00",
  afterAlight: null,
};

describe("車内の人に勧める動き", () => {
  it("次の一手が無く、行き先が次の駅でなければ、行き先まで乗り続ける", () => {
    expect(selectInCarPlan(stay, { kind: "station", name: "西九条" })).toBe("stay");
  });

  it("着いた後の一手があれば、次の駅で降りる", () => {
    expect(
      selectInCarPlan(
        {
          ...stay,
          afterAlight: {
            kind: "transfer",
            text: "天満に着いたら扇町から堺筋線へ",
            line: "堺筋線",
            boardStation: "扇町",
            arrivalTime: "2026-11-07T20:30:00+09:00",
          },
        },
        { kind: "station", name: "西九条" },
      ),
    ).toBe("alight");
  });

  it("次の駅が行き先なら、そこで降りる", () => {
    expect(selectInCarPlan(stay, { kind: "station", name: "天満" })).toBe("alight");
  });

  it("次の駅か動く見込みが分からなければ、どちらとも決めない", () => {
    expect(
      selectInCarPlan({ ...stay, alightStation: null }, { kind: "station", name: "西九条" }),
    ).toBe("unknown");
    expect(
      selectInCarPlan(
        { ...stay, departure: null, departureP80: null },
        { kind: "station", name: "西九条" },
      ),
    ).toBe("unknown");
  });
});

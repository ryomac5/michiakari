import { describe, expect, it } from "vitest";
import { buildInCarBand } from "./in-car-band";

// 駅の間の車内の帯は、動き出す見込みの幅と、次の駅に着く時刻を判断の結果からそのまま置く

const guide = {
  alightStation: "大阪",
  alightArrival: "2026-11-07T20:36:00+09:00",
  departure: "2026-11-07T20:32:00+09:00",
  departureP80: "2026-11-07T20:52:00+09:00",
  afterAlight: null,
};

describe("車内の帯", () => {
  it("動き出す見込みの幅を軸の始まりから遅い側まで置き、着く時刻をその間に置く", () => {
    const band = buildInCarBand(guide);
    expect(band?.start).toBe(guide.departure);
    expect(band?.end).toBe(guide.departureP80);
    expect(band?.departure).toMatchObject({ from: 0, to: 1 });
    expect(band?.arrival?.x).toBeCloseTo(0.2, 5);
    expect(band?.arrival?.station).toBe("大阪");
  });

  it("着く時刻が遅い側より後なら、軸を着く時刻まで伸ばす", () => {
    const band = buildInCarBand({ ...guide, alightArrival: "2026-11-07T21:12:00+09:00" });
    expect(band?.end).toBe("2026-11-07T21:12:00+09:00");
    expect(band?.departure.to).toBeCloseTo(0.5, 5);
    expect(band?.arrival?.x).toBe(1);
  });

  it("遅い側が早い側と同じなら、幅を点にする", () => {
    const band = buildInCarBand({ ...guide, departureP80: guide.departure });
    expect(band?.departure).toMatchObject({ from: 0, to: 0, late: null });
  });

  it("以前の記録で遅い側が無ければ、幅を点にする", () => {
    const band = buildInCarBand({ ...guide, departureP80: undefined });
    expect(band?.departure).toMatchObject({ from: 0, to: 0, late: null });
  });

  it("動き出す見込みが無ければ帯を出さない。線路に降りる案内のときに当たる", () => {
    expect(buildInCarBand({ ...guide, departure: null, departureP80: null })).toBeNull();
  });
});

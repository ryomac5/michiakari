import { describe, expect, it } from "vitest";
import { countStopReasonTrains, estimateStopReasons, type StopReasonsInput } from "../src/index.ts";

// JR 西日本の朝の混む時間。普通の運転間隔は 6 分
const rushJr = { headwayMinutes: 6, operator: "JR西日本", cues: [] } as const;

function estimate(input: Partial<StopReasonsInput> & Pick<StopReasonsInput, "type">) {
  const r = estimateStopReasons({ ...rushJr, stoppedMinutes: 20, ...input });
  if (!r) throw new Error("見込みが出ていない");
  return r;
}

describe("estimateStopReasons", () => {
  it("人身事故では防護無線と詰まりが大半で、当該は小さい", () => {
    const r = estimate({ type: "person_collision" });
    expect(r.trainCounts.own_incident).toBe(1);
    expect(r.trainCounts.protection_received).toBeGreaterThan(1);
    expect(r.trainCounts.dispatcher_order).toBe(0);
    expect(r.shares.protection_received + r.shares.queued_behind).toBeGreaterThan(0.75);
    expect(r.shares.own_incident).toBeLessThan(0.25);
    expect(r.mostLikely).toBe("queued_behind");
  });

  it("大雨ではほぼ指令の指示で、当該は 0", () => {
    const r = estimate({ type: "heavy_rain" });
    expect(r.trainCounts.own_incident).toBe(0);
    expect(r.trainCounts.queued_behind).toBe(0);
    expect(r.trainCounts.protection_received).toBe(0);
    expect(r.shares.own_incident).toBe(0);
    expect(r.shares.dispatcher_order).toBeGreaterThan(0.9);
    expect(r.mostLikely).toBe("dispatcher_order");
  });

  it("急病人では当該が 1 本で、後ろが詰まる", () => {
    const r = estimate({ type: "medical_response", stoppedMinutes: 12 });
    expect(r.trainCounts).toEqual({
      own_incident: 1,
      protection_received: 0,
      dispatcher_order: 0,
      queued_behind: 2,
    });
    expect(r.shares.own_incident).toBeCloseTo(0.33, 2);
    expect(r.shares.queued_behind).toBeCloseTo(0.67, 2);
  });

  it("止まった直後の急病人は当該がいちばん高い", () => {
    const r = estimate({ type: "medical_response", stoppedMinutes: 0 });
    expect(r.mostLikely).toBe("own_incident");
    expect(r.shares.own_incident).toBe(1);
  });

  it("受信が聞こえたら防護無線に確定する", () => {
    const r = estimate({ type: "vehicle_failure", cues: ["protection_received"] });
    expect(r.shares).toEqual({
      own_incident: 0,
      protection_received: 1,
      dispatcher_order: 0,
      queued_behind: 0,
    });
    expect(r.mostLikely).toBe("protection_received");
  });

  it("受信が聞こえれば、種類が分からなくても防護無線に確定する", () => {
    const r = estimateStopReasons({
      ...rushJr,
      type: null,
      cues: ["protection_received"],
      stoppedMinutes: 0,
    });
    expect(r?.mostLikely).toBe("protection_received");
  });

  it("詰まりの放送が聞こえたら詰まりを大きく上げる", () => {
    const base = estimate({ type: "vehicle_failure", stoppedMinutes: 3 });
    const heard = estimate({ type: "vehicle_failure", stoppedMinutes: 3, cues: ["queue_ahead"] });
    expect(base.mostLikely).toBe("own_incident");
    expect(heard.mostLikely).toBe("queued_behind");
    expect(heard.shares.queued_behind).toBeGreaterThan(0.8);
    // 本数の内訳は手がかりで変えない
    expect(heard.trainCounts).toEqual(base.trainCounts);
  });

  it("種類も決め手の手がかりも無ければ見込みを出さない", () => {
    expect(estimateStopReasons({ ...rushJr, type: null, stoppedMinutes: 10 })).toBeNull();
  });

  it("防護無線の本数は上下の運転間隔と速度の目安から出す", () => {
    // JR の普通は 35km/h。6 分間隔なら列車の間隔は 3.5km。前後 1km の上下で 4km ぶん
    const counts = countStopReasonTrains({
      ...rushJr,
      type: "person_collision",
      stoppedMinutes: 0,
    });
    expect(counts.protection_received).toBeCloseTo(4 / 3.5, 5);
  });

  it("運転間隔が長い時間帯は、詰まりの本数が減る", () => {
    const rush = estimate({ type: "person_collision" });
    const night = estimate({ type: "person_collision", headwayMinutes: 15 });
    expect(night.trainCounts.queued_behind).toBeLessThan(rush.trainCounts.queued_behind);
  });

  it("割合を足すと 1 になる", () => {
    const r = estimate({ type: "track_intrusion", stoppedMinutes: 7 });
    const sum = Object.values(r.shares).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 1);
  });

  it("運転間隔が正でなければ投げる", () => {
    expect(() =>
      estimateStopReasons({ ...rushJr, headwayMinutes: 0, type: "heavy_rain", stoppedMinutes: 0 }),
    ).toThrow(RangeError);
  });
});

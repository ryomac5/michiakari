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
  it("人身事故では、受信の範囲の外の列車も指令の指示で止まり、当該は小さい", () => {
    const r = estimate({ type: "person_collision" });
    expect(r.trainCounts.own_incident).toBe(1);
    expect(r.trainCounts.protection_received).toBeGreaterThan(1);
    expect(r.trainCounts.dispatcher_order).toBeGreaterThan(r.trainCounts.protection_received);
    expect(r.trainCounts.queued_behind).toBeGreaterThan(3);
    expect(r.shares.own_incident).toBeLessThan(0.1);
    expect(r.mostLikely).toBe("dispatcher_order");
  });

  it("人身事故で止まった直後でも、昼の運転間隔なら当該は 2 割を下回る", () => {
    const r = estimate({ type: "person_collision", headwayMinutes: 10, stoppedMinutes: 0 });
    expect(r.trainCounts.queued_behind).toBe(0);
    expect(r.shares.own_incident).toBeLessThan(0.2);
    expect(r.mostLikely).toBe("dispatcher_order");
  });

  it("利用者は止まった列車のどれかに乗っているので、当該の割合は 1 ÷ 止まった本数の合計", () => {
    for (const [type, stoppedMinutes] of [
      ["person_collision", 0],
      ["person_collision", 20],
      ["vehicle_failure", 7],
      ["track_intrusion", 3],
    ] as const) {
      const counts = countStopReasonTrains({ ...rushJr, type, stoppedMinutes });
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const r = estimate({ type, stoppedMinutes });
      // 100 分の 1 に丸めるので、差は 0.01 以内
      expect(Math.abs(r.shares.own_incident - 1 / total)).toBeLessThanOrEqual(0.01);
    }
  });

  it("防護無線の事象の指令の指示は、止める範囲の本数から受信の範囲の本数を引いた残り", () => {
    // JR の普通は 35km/h。6 分間隔なら列車の間隔は 3.5km
    // 止める範囲は前後 10km の上下で 40km ぶん、受信の範囲は前後 1km の上下で 4km ぶん
    const counts = countStopReasonTrains({
      ...rushJr,
      type: "person_collision",
      stoppedMinutes: 0,
    });
    expect(counts.protection_received).toBeCloseTo(4 / 3.5, 5);
    expect(counts.dispatcher_order).toBeCloseTo(40 / 3.5 - 4 / 3.5, 5);
  });

  it("大雨では指令が区間ごと止めるので、当該も詰まりも 0 で、後ろの列車も指令の指示に数える", () => {
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
    expect(r.shares.own_incident).toBe(0.33);
    expect(r.shares.queued_behind).toBe(0.67);
  });

  it("同じ割合なら、詰まりを当該より先に選ぶ", () => {
    const r = estimate({ type: "medical_response", headwayMinutes: 10, stoppedMinutes: 10 });
    expect(r.shares.own_incident).toBe(r.shares.queued_behind);
    expect(r.mostLikely).toBe("queued_behind");
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

  it("受信の放送が無かったと答えたら、人身事故でも受信の本数を 0 にし、その分を指令の指示に数える", () => {
    const heardUnknown = countStopReasonTrains({
      ...rushJr,
      type: "person_collision",
      stoppedMinutes: 0,
    });
    const notHeard = countStopReasonTrains({
      ...rushJr,
      type: "person_collision",
      stoppedMinutes: 0,
      protectionBroadcast: "not_heard",
    });
    expect(notHeard.protection_received).toBe(0);
    expect(notHeard.own_incident).toBe(1);
    expect(notHeard.dispatcher_order).toBeCloseTo(40 / 3.5, 5);
    expect(notHeard.dispatcher_order).toBeCloseTo(
      heardUnknown.dispatcher_order + heardUnknown.protection_received,
      5,
    );
    const r = estimate({ type: "person_collision", protectionBroadcast: "not_heard" });
    expect(r.shares.protection_received).toBe(0);
    expect(r.trainCounts.protection_received).toBe(0);
    expect(r.mostLikely).toBe("dispatcher_order");
  });

  it("覚えていないと答えたときは、答えが無いときと同じ見込みを出す", () => {
    expect(estimate({ type: "person_collision", protectionBroadcast: "unknown" })).toEqual(
      estimate({ type: "person_collision" }),
    );
  });

  it("入口で受信の放送が聞こえたと答えたら、種類が分からなくても防護無線に確定する", () => {
    const r = estimate({ type: null, protectionBroadcast: "heard" });
    expect(r.mostLikely).toBe("protection_received");
    expect(r.shares.protection_received).toBe(1);
  });

  it("無かったと答えても、後から持ち込んだ放送に受信の手がかりがあればそちらを採る", () => {
    const r = estimate({
      type: "person_collision",
      cues: ["protection_received"],
      protectionBroadcast: "not_heard",
    });
    expect(r.mostLikely).toBe("protection_received");
    expect(r.trainCounts.protection_received).toBeGreaterThan(0);
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

  it("運転間隔が長い時間帯は、詰まりの本数が減る", () => {
    const rush = estimate({ type: "person_collision" });
    const night = estimate({ type: "person_collision", headwayMinutes: 15 });
    expect(night.trainCounts.queued_behind).toBeLessThan(rush.trainCounts.queued_behind);
  });

  it("丸めた割合を足すと、ちょうど 1 になる", () => {
    const cases: Partial<StopReasonsInput>[] = [
      { type: "track_intrusion", stoppedMinutes: 7 },
      { type: "person_collision", stoppedMinutes: 0, headwayMinutes: 10 },
      { type: "person_collision", stoppedMinutes: 13, headwayMinutes: 7 },
      { type: "medical_response", stoppedMinutes: 5, headwayMinutes: 9 },
      { type: "vehicle_failure", stoppedMinutes: 3, cues: ["queue_ahead"] },
      { type: "heavy_rain", stoppedMinutes: 20 },
    ];
    for (const c of cases) {
      const r = estimate({ type: null, ...c });
      const units = Object.values(r.shares).map((share) => Math.round(share * 100));
      expect(units.reduce((a, b) => a + b, 0)).toBe(100);
      for (const share of Object.values(r.shares))
        expect(Math.round(share * 100) / 100).toBe(share);
    }
  });

  it("止まってからの分が有限でないか負なら、0 分として扱う", () => {
    const zero = estimate({ type: "medical_response", stoppedMinutes: 0 });
    for (const stoppedMinutes of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const r = estimate({ type: "medical_response", stoppedMinutes });
      expect(r).toEqual(zero);
      expect(r.trainCounts.queued_behind).toBe(0);
    }
  });

  it("運転間隔が正でなければ投げる", () => {
    expect(() =>
      estimateStopReasons({ ...rushJr, headwayMinutes: 0, type: "heavy_rain", stoppedMinutes: 0 }),
    ).toThrow(RangeError);
  });
});

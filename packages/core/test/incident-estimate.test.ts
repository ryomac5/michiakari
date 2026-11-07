import { describe, expect, it } from "vitest";
import { estimateIncidentRemaining } from "../src/index.ts";

const onset = "2026-11-04T13:00:00+09:00";

describe("estimateIncidentRemaining", () => {
  it("再開の手がかりがあれば初列車待ちだけ", () => {
    const r = estimateIncidentRemaining({
      type: "heavy_rain",
      cues: ["resumed"],
      statedResumeTime: "2026-11-04T14:00:00+09:00",
      onsetTime: onset,
      now: "2026-11-04T13:30:00+09:00",
    });
    expect(r.basis).toBe("resumed");
    expect(r.untilResume).toEqual({ p50: 0, p80: 0 });
    expect(r.remaining).toEqual(r.firstTrainWait);
  });

  it("発表の時刻があれば、その時刻までに初列車待ちを足す", () => {
    const r = estimateIncidentRemaining({
      type: "vehicle_failure",
      cues: [],
      statedResumeTime: "2026-11-04T13:40:00+09:00",
      onsetTime: onset,
      now: "2026-11-04T13:10:00+09:00",
    });
    expect(r.basis).toBe("stated");
    expect(r.untilResume).toEqual({ p50: 30, p80: 40 });
    expect(r.remaining).toEqual({ p50: 35, p80: 55 });
  });

  it("規則 6: 短い事象は目安から経過を引く", () => {
    const r = estimateIncidentRemaining({
      type: "medical_response",
      cues: [],
      statedResumeTime: null,
      onsetTime: onset,
      now: "2026-11-04T13:02:00+09:00",
    });
    expect(r.basis).toBe("rule");
    expect(r.untilResume).toEqual({ p50: 3, p80: 13 });
    expect(r.remaining).toEqual({ p50: 5, p80: 18 });
    expect(r.flowOutlook).toBe("short");
  });

  it("経過が目安の p80 を超えたら統計値に移る", () => {
    const r = estimateIncidentRemaining({
      type: "track_intrusion",
      cues: [],
      statedResumeTime: null,
      onsetTime: onset,
      now: "2026-11-04T13:40:00+09:00",
    });
    expect(r.basis).toBe("statistics");
    expect(r.statistics?.level).toBe("group");
    expect(r.samples?.length).toBeGreaterThan(0);
  });

  it("長い事象は統計値を使う", () => {
    const r = estimateIncidentRemaining({
      type: "person_collision",
      cues: [],
      statedResumeTime: null,
      onsetTime: onset,
      now: onset,
    });
    expect(r.basis).toBe("statistics");
    expect(r.statistics).toMatchObject({ level: "type", id: "person_collision" });
    expect(r.remaining?.p50).toBe((r.untilResume?.p50 ?? 0) + r.firstTrainWait.p50);
  });

  it("規則 7: めったに無い事象は数字を出さない印を返す", () => {
    const r = estimateIncidentRemaining({
      type: "lightning",
      cues: [],
      statedResumeTime: null,
      onsetTime: onset,
      now: onset,
    });
    expect(r).toMatchObject({ basis: null, remaining: null, withholdNumbers: true });
  });

  it("種類が分からなければ入口の大分類の統計値、それも無ければ null", () => {
    const byGroup = estimateIncidentRemaining({
      type: null,
      cause: { group: "weather", type: null },
      cues: [],
      statedResumeTime: null,
      onsetTime: onset,
      now: onset,
    });
    expect(byGroup.basis).toBe("statistics");
    const none = estimateIncidentRemaining({
      type: null,
      cues: [],
      statedResumeTime: null,
      onsetTime: onset,
      now: onset,
    });
    expect(none).toMatchObject({ basis: null, remaining: null, withholdNumbers: false });
  });
});

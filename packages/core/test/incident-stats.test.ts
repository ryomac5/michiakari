import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMUTE_HOUR_RANGES, MONTE_CARLO_SAMPLE_COUNT } from "../params/estimation.ts";
import { INCIDENT_GROUP_DURATIONS, INCIDENT_TYPE_DURATIONS } from "../params/incident-durations.ts";
import {
  classifyDurationPeriod,
  estimateStatsRemaining,
  type IncidentDurationTables,
  resolveIncidentDuration,
} from "../src/index.ts";

// 2026-11-06 は金曜、2026-11-07 は土曜
const weekdayCommute = "2026-11-06T08:30:00+09:00";
const weekdayDaytime = "2026-11-06T12:00:00+09:00";
const saturdayMorning = "2026-11-07T08:30:00+09:00";

function readPeriod(level: "group" | "type", id: string, period: "commute" | "other") {
  const stats =
    level === "group"
      ? INCIDENT_GROUP_DURATIONS[id as keyof typeof INCIDENT_GROUP_DURATIONS]
      : INCIDENT_TYPE_DURATIONS[id as keyof typeof INCIDENT_TYPE_DURATIONS];
  const p = stats.byPeriod[period];
  return { p50: p.p50, p80: p.p80 };
}

describe("classifyDurationPeriod", () => {
  it("平日の 7〜9 時台と 17〜19 時台は通勤、それ以外と土日はそれ以外", () => {
    expect(classifyDurationPeriod(weekdayCommute)).toBe("commute");
    expect(classifyDurationPeriod("2026-11-06T07:00:00+09:00")).toBe("commute");
    expect(classifyDurationPeriod("2026-11-06T09:59:00+09:00")).toBe("commute");
    expect(classifyDurationPeriod("2026-11-06T10:00:00+09:00")).toBe("other");
    expect(classifyDurationPeriod("2026-11-06T06:59:00+09:00")).toBe("other");
    expect(classifyDurationPeriod("2026-11-06T17:00:00+09:00")).toBe("commute");
    expect(classifyDurationPeriod("2026-11-06T19:59:00+09:00")).toBe("commute");
    expect(classifyDurationPeriod("2026-11-06T20:00:00+09:00")).toBe("other");
    expect(classifyDurationPeriod(weekdayDaytime)).toBe("other");
    expect(classifyDurationPeriod(saturdayMorning)).toBe("other");
    expect(classifyDurationPeriod("2026-11-08T18:00:00+09:00")).toBe("other");
  });

  it("日本時間で数える。UTC の前日 23 時半は日本時間の金曜 8 時半", () => {
    expect(classifyDurationPeriod("2026-11-05T23:30:00Z")).toBe("commute");
  });

  it("境は生成元の COMMUTE_HOURS と一致する", () => {
    const script = readFileSync(
      new URL(
        "../../../docs/research/rail-suspensions/build_incident_durations.py",
        import.meta.url,
      ),
      "utf-8",
    );
    const line = /^COMMUTE_HOURS = (.+)$/m.exec(script)?.[1] ?? "";
    const ranges = [...line.matchAll(/range\((\d+), (\d+)\)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(ranges).toEqual(COMMUTE_HOUR_RANGES.map((r) => [...r]));
  });
});

describe("resolveIncidentDuration", () => {
  it("種類を聞かない大分類は、大分類の時間帯の値を使う", () => {
    const other = resolveIncidentDuration({ group: "signaling", type: null }, weekdayDaytime);
    expect(other).toEqual({
      level: "group",
      id: "signaling",
      period: "other",
      duration: readPeriod("group", "signaling", "other"),
    });
  });

  it("通勤時間帯とそれ以外で値を切り替える", () => {
    const commute = resolveIncidentDuration({ group: "obstruction", type: null }, weekdayCommute);
    const other = resolveIncidentDuration({ group: "obstruction", type: null }, saturdayMorning);
    expect(commute?.period).toBe("commute");
    expect(other?.period).toBe("other");
    expect(commute?.duration).toEqual(readPeriod("group", "obstruction", "commute"));
    expect(other?.duration).toEqual(readPeriod("group", "obstruction", "other"));
    expect(commute?.duration).not.toEqual(other?.duration);
  });

  it("件数の足りない時間帯は、まぜた値を使う", () => {
    const stats = INCIDENT_GROUP_DURATIONS.signaling;
    expect(stats.byPeriod.commute.reliability).toBe("use_mixed");
    const commute = resolveIncidentDuration({ group: "signaling", type: null }, weekdayCommute);
    expect(commute?.duration).toEqual({ p50: stats.p50, p80: stats.p80 });
  });

  it("件数の足りる種類は、種類の値を使う", () => {
    expect(INCIDENT_TYPE_DURATIONS.person_collision.reliability).toBe("sufficient");
    const resolved = resolveIncidentDuration(
      { group: "passenger", type: "person_collision" },
      weekdayDaytime,
    );
    expect(resolved).toEqual({
      level: "type",
      id: "person_collision",
      period: "other",
      duration: readPeriod("type", "person_collision", "other"),
    });
  });

  it("use_group の印の付いた種類は、大分類の値を使う", () => {
    expect(INCIDENT_TYPE_DURATIONS.snow_ice.reliability).toBe("use_group");
    const resolved = resolveIncidentDuration(
      { group: "weather", type: "snow_ice" },
      weekdayDaytime,
    );
    expect(resolved).toMatchObject({ level: "group", id: "weather" });
    expect(resolved?.duration).toEqual(readPeriod("group", "weather", "other"));
  });

  it("時間の分かる事例が無く null の種類は、大分類の値を使う", () => {
    expect(INCIDENT_TYPE_DURATIONS.medical_response.p50).toBeNull();
    const resolved = resolveIncidentDuration(
      { group: "passenger", type: "medical_response" },
      weekdayCommute,
    );
    expect(resolved).toMatchObject({ level: "group", id: "passenger", period: "commute" });
    expect(resolved?.duration).toEqual(readPeriod("group", "passenger", "commute"));
  });

  it("大分類と合わない種類は使わず、大分類の値を使う", () => {
    const resolved = resolveIncidentDuration(
      { group: "signaling", type: "person_collision" },
      weekdayDaytime,
    );
    expect(resolved).toMatchObject({ level: "group", id: "signaling" });
  });

  it("統計値に無い大分類は null", () => {
    expect(resolveIncidentDuration({ group: "unknown_group", type: null }, weekdayDaytime)).toBe(
      null,
    );
  });

  it("件数の足りない大分類は、種類も大分類も使えず null", () => {
    const tables: IncidentDurationTables = {
      groups: {
        ...INCIDENT_GROUP_DURATIONS,
        power: { ...INCIDENT_GROUP_DURATIONS.power, reliability: "insufficient" },
      },
      types: INCIDENT_TYPE_DURATIONS,
    };
    expect(
      resolveIncidentDuration({ group: "power", type: "power_outage" }, weekdayDaytime, tables),
    ).toBeNull();
  });
});

describe("estimateStatsRemaining", () => {
  it("止まった直後は、所要時間の p50 と p80 に近い残りを返す", () => {
    const result = estimateStatsRemaining(
      { group: "signaling", type: null },
      weekdayDaytime,
      weekdayDaytime,
    );
    const duration = readPeriod("group", "signaling", "other");
    expect(result).not.toBeNull();
    expect(Math.abs((result?.remaining.p50 ?? 0) - (duration.p50 ?? 0))).toBeLessThanOrEqual(3);
    expect(Math.abs((result?.remaining.p80 ?? 0) - (duration.p80 ?? 0))).toBeLessThanOrEqual(5);
    expect(result?.samples).toHaveLength(MONTE_CARLO_SAMPLE_COUNT);
    const samples = result?.samples ?? [];
    expect(samples.every((v, i) => i === 0 || (samples[i - 1] ?? 0) <= v)).toBe(true);
  });

  it("発生からの経過を差し引き、経過を超えた条件付きの残りにする", () => {
    const cause = { group: "signaling", type: null };
    const fresh = estimateStatsRemaining(cause, weekdayDaytime, weekdayDaytime);
    const later = estimateStatsRemaining(cause, weekdayDaytime, "2026-11-06T13:00:00+09:00");
    expect(later?.remaining.p50).toBeLessThan(fresh?.remaining.p50 ?? 0);
    expect(later?.remaining.p50).toBeGreaterThan((fresh?.remaining.p50 ?? 0) - 60);
    expect(later?.resolved.period).toBe("other");
  });

  it("時間帯は止まった時刻で決め、いまの時刻では決めない", () => {
    const result = estimateStatsRemaining(
      { group: "signaling", type: "signal_failure" },
      "2026-11-06T09:30:00+09:00",
      "2026-11-06T10:30:00+09:00",
    );
    expect(result?.resolved).toMatchObject({ level: "type", period: "commute" });
  });

  it("同じ入力なら同じ値を返す", () => {
    const cause = { group: "weather", type: "strong_wind" };
    expect(estimateStatsRemaining(cause, weekdayCommute, weekdayCommute)?.remaining).toEqual(
      estimateStatsRemaining(cause, weekdayCommute, weekdayCommute)?.remaining,
    );
  });

  it("使える統計値が無ければ null", () => {
    expect(
      estimateStatsRemaining(
        { group: "unknown_group", type: null },
        weekdayDaytime,
        weekdayDaytime,
      ),
    ).toBeNull();
  });
});

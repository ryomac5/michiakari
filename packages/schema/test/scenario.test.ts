import { describe, expect, it } from "vitest";
import {
  checkScenarioIntegrity,
  resolveDeadline,
  type Scenario,
  ScenarioSchema,
} from "../src/index.ts";
import { readFixtureYaml } from "./fixtures/load.ts";

function loadValid(): Scenario {
  return ScenarioSchema.parse(readFixtureYaml("scenario.valid.yaml"));
}

describe("ScenarioSchema", () => {
  it("雛形の全キーと weather を持つ YAML を受け入れる", () => {
    const s = loadValid();
    expect(s.weather?.readings).toHaveLength(2);
    expect(checkScenarioIntegrity(s)).toEqual([]);
  });

  it("weather を省略できる", () => {
    const { weather: _omit, ...rest } = loadValid();
    expect(ScenarioSchema.safeParse(rest).success).toBe(true);
  });

  it("未知のキーを拒否する", () => {
    expect(ScenarioSchema.safeParse({ ...loadValid(), extra: 1 }).success).toBe(false);
  });

  it("timeline が空なら拒否する", () => {
    expect(ScenarioSchema.safeParse({ ...loadValid(), timeline: [] }).success).toBe(false);
  });

  it.each(["24:00", "9:30", "23:60", "2345"])("deadline %s を拒否する", (deadline) => {
    const s = loadValid();
    s.user.constraints.deadline = deadline;
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
  });

  it("deadline に null を許す", () => {
    const s = loadValid();
    s.user.constraints.deadline = null;
    expect(ScenarioSchema.safeParse(s).success).toBe(true);
  });

  it("オフセットのない start_time を拒否する", () => {
    expect(
      ScenarioSchema.safeParse({ ...loadValid(), start_time: "2026-11-05T22:40:00" }).success,
    ).toBe(false);
  });

  it("負の offset_minutes を拒否する", () => {
    const s = loadValid();
    const entry = s.timeline[0];
    if (entry) entry.offset_minutes = -1;
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
  });

  it("検査項目が一つもない expectation を拒否する", () => {
    const s = loadValid();
    s.expectations.push({ after: "obs_1", note: "検査項目なし" });
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
  });

  it("break_even_shown だけの expectation を受け入れる", () => {
    const s = loadValid();
    s.expectations.push({ after: "obs_1", break_even_shown: false, note: "分岐点のみ" });
    expect(ScenarioSchema.safeParse(s).success).toBe(true);
  });

  it("負の雨量を拒否する", () => {
    const s = loadValid();
    const reading = s.weather?.readings[0];
    if (reading) reading.rainfall_10min_mm = -0.5;
    expect(ScenarioSchema.safeParse(s).success).toBe(false);
  });
});

describe("checkScenarioIntegrity", () => {
  it("timeline id の重複を検出する", () => {
    const s = loadValid();
    const second = s.timeline[1];
    if (second) second.id = "obs_1";
    expect(checkScenarioIntegrity(s)).toContain("timeline id が重複しています: obs_1");
  });

  it("同じ offset_minutes の連続は許す", () => {
    const s = loadValid();
    const second = s.timeline[1];
    if (second) second.offset_minutes = 0;
    expect(checkScenarioIntegrity(s)).toEqual([]);
  });

  it("offset_minutes の逆順を検出する", () => {
    const s = loadValid();
    const first = s.timeline[0];
    if (first) first.offset_minutes = 30;
    expect(checkScenarioIntegrity(s)).toEqual([
      "timeline の offset_minutes が昇順ではありません: obs_1 → obs_2",
    ]);
  });

  it("weather.readings の逆順を検出する", () => {
    const s = loadValid();
    const first = s.weather?.readings[0];
    if (first) first.offset_minutes = 20;
    expect(checkScenarioIntegrity(s)).toEqual([
      "weather.readings の offset_minutes が狭義の昇順ではありません: 20 → 10",
    ]);
  });

  it("weather.readings の同じ offset_minutes の重複を検出する", () => {
    const s = loadValid();
    const second = s.weather?.readings[1];
    if (second) second.offset_minutes = 0;
    expect(checkScenarioIntegrity(s)).toEqual([
      "weather.readings の offset_minutes が狭義の昇順ではありません: 0 → 0",
    ]);
  });

  it("未定義の timeline id を指す expectations.after を検出する", () => {
    const s = loadValid();
    s.expectations.push({ after: "obs_9", action: "wait", note: "" });
    expect(checkScenarioIntegrity(s)).toEqual([
      "expectations.after が未定義の timeline id を指しています: obs_9",
    ]);
  });
});

describe("resolveDeadline", () => {
  it("同じ日のうちに来る時刻を返す", () => {
    expect(resolveDeadline("2026-11-05T22:40:00+09:00", "23:45")).toBe("2026-11-05T23:45:00+09:00");
  });

  it("開始時刻より前の時刻は翌日にする", () => {
    expect(resolveDeadline("2026-11-05T22:40:00+09:00", "00:30")).toBe("2026-11-06T00:30:00+09:00");
  });

  it("開始時刻と同じ時刻はその時刻を返す", () => {
    expect(resolveDeadline("2026-11-05T22:40:00+09:00", "22:40")).toBe("2026-11-05T22:40:00+09:00");
  });

  it("早朝開始で後の時刻は同じ日にする", () => {
    expect(resolveDeadline("2026-11-06T01:00:00+09:00", "02:00")).toBe("2026-11-06T02:00:00+09:00");
  });

  it("月末と年末をまたぐ", () => {
    expect(resolveDeadline("2026-12-31T23:50:00+09:00", "00:10")).toBe("2027-01-01T00:10:00+09:00");
  });

  it("UTC 表記の開始時刻も日本時間で解釈する", () => {
    // 2026-11-05T22:40+09:00 と同じ瞬間
    expect(resolveDeadline("2026-11-05T13:40:00Z", "23:45")).toBe("2026-11-05T23:45:00+09:00");
  });

  it("不正な入力で例外を投げる", () => {
    expect(() => resolveDeadline("2026-11-05T22:40:00", "23:45")).toThrow();
    expect(() => resolveDeadline("2026-11-05T22:40:00+09:00", "25:00")).toThrow();
  });
});

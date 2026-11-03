import { describe, expect, it } from "vitest";
import { checkKnowledgeIntegrity, type Knowledge, KnowledgeSchema } from "../src/index.ts";
import { readFixtureYaml } from "./fixtures/load.ts";

function loadValid(): Knowledge {
  return KnowledgeSchema.parse(readFixtureYaml("knowledge.valid.yaml"));
}

describe("KnowledgeSchema", () => {
  it("雛形の全キーを持つ YAML を受け入れる", () => {
    const k = loadValid();
    expect(k.phases).toHaveLength(2);
    expect(checkKnowledgeIntegrity(k)).toEqual([]);
  });

  it("未知のキーを拒否する", () => {
    const raw = { ...loadValid(), extra: 1 };
    expect(KnowledgeSchema.safeParse(raw).success).toBe(false);
  });

  it("phase 内の未知のキーを拒否する", () => {
    const raw = loadValid();
    const phase = { ...raw.phases[0], unknown: true };
    expect(KnowledgeSchema.safeParse({ ...raw, phases: [phase] }).success).toBe(false);
  });

  it("phases が空なら拒否する", () => {
    expect(KnowledgeSchema.safeParse({ ...loadValid(), phases: [] }).success).toBe(false);
  });

  it("所要時間が null の雛形のままなら拒否する", () => {
    const raw = structuredClone(loadValid()) as unknown as {
      phases: { duration_minutes: unknown }[];
    };
    const first = raw.phases[0];
    if (first) first.duration_minutes = { p50: null, p80: null };
    expect(KnowledgeSchema.safeParse(raw).success).toBe(false);
  });

  it("observable_from が空なら拒否する", () => {
    const raw = structuredClone(loadValid());
    const signal = raw.phases[0]?.signals[0];
    if (signal) signal.observable_from = [];
    expect(KnowledgeSchema.safeParse(raw).success).toBe(false);
  });

  it("predictability が無くても受け入れる", () => {
    expect(loadValid().predictability).toBeUndefined();
  });

  it("predictability を受け入れる。typical_floor_minutes は省略できる", () => {
    const basis = { ja: "現場確認を経るため、再開までの流れがほぼ決まっている" };
    const withFloor = { level: "high", basis, typical_floor_minutes: 60 };
    const withoutFloor = { level: "low", basis };
    for (const predictability of [withFloor, withoutFloor]) {
      const parsed = KnowledgeSchema.parse({ ...loadValid(), predictability });
      expect(parsed.predictability).toEqual(predictability);
    }
  });

  it("predictability の不正な値を拒否する", () => {
    const basis = { ja: "理由" };
    const invalid = [
      { level: "certain", basis },
      { level: "high" },
      { level: "high", basis, typical_floor_minutes: -1 },
      { level: "high", basis, typical_floor_minutes: 1.5 },
      { level: "high", basis, extra: true },
    ];
    for (const predictability of invalid) {
      expect(KnowledgeSchema.safeParse({ ...loadValid(), predictability }).success).toBe(false);
    }
  });

  it("snake_case 以外の id を拒否する", () => {
    expect(KnowledgeSchema.safeParse({ ...loadValid(), id: "TODO_event_id" }).success).toBe(false);
  });
});

describe("checkKnowledgeIntegrity", () => {
  it("phase id の重複を検出する", () => {
    const k = loadValid();
    const [first, second] = k.phases;
    if (!first || !second) throw new Error("fixture");
    second.id = first.id;
    expect(checkKnowledgeIntegrity(k)).toEqual(["phase id が重複しています: initial"]);
  });

  it("signal id の重複を phase をまたいで検出する", () => {
    const k = loadValid();
    const signal = k.phases[1]?.signals[0];
    if (!signal) throw new Error("fixture");
    signal.id = "checking_announced";
    const errors = checkKnowledgeIntegrity(k);
    expect(errors).toContain("signal id が重複しています: checking_announced");
  });

  it("未定義の signal を指す exit_signals を検出する", () => {
    const k = loadValid();
    k.phases[0]?.exit_signals.push("no_such_signal");
    expect(checkKnowledgeIntegrity(k)).toEqual([
      "phase initial の exit_signals が未定義の signal を指しています: no_such_signal",
    ]);
  });
});

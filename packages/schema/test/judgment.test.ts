import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkJudgmentRefs, type Judgment, JudgmentSchema, RouteLegSchema } from "../src/index.ts";
import { validJudgment } from "./fixtures/api.ts";

function cloneJudgment(): Judgment {
  return structuredClone(validJudgment);
}

describe("JudgmentSchema", () => {
  it("合格例を受け入れる", () => {
    expect(JudgmentSchema.safeParse(validJudgment).success).toBe(true);
    expect(checkJudgmentRefs(validJudgment)).toEqual([]);
  });

  it("hold で分岐点・推奨・残り時間がなくても受け入れる", () => {
    const j = cloneJudgment();
    j.action = "hold";
    j.breakEven = null;
    j.recommendedOptionId = null;
    j.options = [];
    j.estimate = {
      ...j.estimate,
      eventType: null,
      phaseId: null,
      elapsedMinutes: null,
      remaining: null,
    };
    expect(JudgmentSchema.safeParse(j).success).toBe(true);
    expect(checkJudgmentRefs(j)).toEqual([]);
  });

  it("reason は任意で、あれば受け入れ、空文字は拒否する", () => {
    expect(
      JudgmentSchema.safeParse({ ...validJudgment, reason: "現場の確認が続いています。" }).success,
    ).toBe(true);
    expect(JudgmentSchema.safeParse({ ...validJudgment, reason: "" }).success).toBe(false);
  });

  it("以前の記録にある typicalFlow は受け付けて読み飛ばす", () => {
    const parsed = JudgmentSchema.parse({ ...validJudgment, typicalFlow: { phases: [] } });
    expect(parsed).not.toHaveProperty("typicalFlow");
  });

  it("見込みの出どころの knowledge を rule に読み替える", () => {
    const j = cloneJudgment();
    const parsed = JudgmentSchema.parse({ ...j, estimate: { ...j.estimate, source: "knowledge" } });
    expect(parsed.estimate.source).toBe("rule");
    expect(
      JudgmentSchema.safeParse({ ...j, estimate: { ...j.estimate, source: "guess" } }).success,
    ).toBe(false);
    const { source: _omitted, ...withoutSource } = j.estimate;
    expect(JudgmentSchema.parse({ ...j, estimate: withoutSource }).estimate.source).toBeUndefined();
  });

  it("手がかり、防護無線、支障の無い線路、詰まりの欄は任意で、あれば受け入れる", () => {
    const outlook = {
      cues: ["protection_received", "queue_ahead"],
      protection: true,
      unaffectedTrack: { trackSide: "unknown", affected: null, opposite: { p50: 5, p80: 10 } },
      resumeQueue: {
        closesUp: false,
        trainsInQueue: 1,
        waitRange: null,
        queueAnnounced: true,
        worthAlightingAtNextStation: false,
      },
    };
    expect(JudgmentSchema.safeParse({ ...validJudgment, ...outlook }).success).toBe(true);
    expect(JudgmentSchema.safeParse({ ...validJudgment, cues: ["knowledge"] }).success).toBe(false);
    expect(
      JudgmentSchema.safeParse({
        ...validJudgment,
        unaffectedTrack: { ...outlook.unaffectedTrack, trackSide: "up" },
      }).success,
    ).toBe(false);
  });

  it("根拠の種類に knowledge を受け付けず、cue を受け付ける", () => {
    const evidence = (kind: string) => [
      { kind, id: "resumed", description: "運転を再開しました。" },
    ];
    expect(JudgmentSchema.safeParse({ ...validJudgment, evidence: evidence("cue") }).success).toBe(
      true,
    );
    expect(
      JudgmentSchema.safeParse({ ...validJudgment, evidence: evidence("knowledge") }).success,
    ).toBe(false);
  });

  it("busChecks は任意で、3 件までを受け入れ、到着時刻を持たない", () => {
    const busCheck = {
      id: "P11-22_27:1",
      stopName: "架空停留所前",
      operators: [{ name: "架空バス", officialUrl: "https://example.com/" }],
      lon: 135.5,
      lat: 34.7,
      walkMinutes: 4,
      dataYear: 2022,
    };
    expect(JudgmentSchema.safeParse({ ...validJudgment, busChecks: [busCheck] }).success).toBe(
      true,
    );
    expect(
      JudgmentSchema.safeParse({
        ...validJudgment,
        busChecks: [{ ...busCheck, operators: [{ name: "架空バス", officialUrl: null }] }],
      }).success,
    ).toBe(true);
    expect(
      JudgmentSchema.safeParse({ ...validJudgment, busChecks: Array(4).fill(busCheck) }).success,
    ).toBe(false);
    expect(
      JudgmentSchema.safeParse({ ...validJudgment, busChecks: [{ ...busCheck, operators: [] }] })
        .success,
    ).toBe(false);
  });

  it("disclaimer が空なら拒否する", () => {
    expect(JudgmentSchema.safeParse({ ...validJudgment, disclaimer: "" }).success).toBe(false);
  });

  it("disclaimer の欠落を拒否する", () => {
    const { disclaimer: _d, ...rest } = validJudgment;
    expect(JudgmentSchema.safeParse(rest).success).toBe(false);
  });

  it("残り時間の p80 < p50 を拒否する", () => {
    const j = cloneJudgment();
    j.estimate.remaining = { p50: 30, p80: 10 };
    expect(JudgmentSchema.safeParse(j).success).toBe(false);
  });

  it("負の運賃と未知の移動手段を拒否する", () => {
    const j = cloneJudgment();
    const option = j.options[0];
    if (!option) throw new Error("fixture");
    expect(JudgmentSchema.safeParse({ ...j, options: [{ ...option, fareYen: -1 }] }).success).toBe(
      false,
    );
    const legs = [{ mode: "bike", from: "甲駅", to: "丙駅", minutes: 10 }];
    expect(JudgmentSchema.safeParse({ ...j, options: [{ ...option, legs }] }).success).toBe(false);
  });

  it("未知の action と evidence の種類を拒否する", () => {
    expect(JudgmentSchema.safeParse({ ...validJudgment, action: "run" }).success).toBe(false);
    const evidence = [{ kind: "rumor", id: "x", description: "" }];
    expect(JudgmentSchema.safeParse({ ...validJudgment, evidence }).success).toBe(false);
  });

  it("z.toJSONSchema で例外なく変換できる", () => {
    const schema = z.toJSONSchema(JudgmentSchema);
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("disclaimer");
  });
});

describe("checkJudgmentRefs", () => {
  it("switch で recommendedOptionId がなければ検出する", () => {
    const j = cloneJudgment();
    j.recommendedOptionId = null;
    expect(checkJudgmentRefs(j)).toEqual([
      "action が switch のときは recommendedOptionId が必要です",
    ]);
  });

  it("options にない recommendedOptionId を検出する", () => {
    const j = cloneJudgment();
    j.action = "wait";
    j.recommendedOptionId = "taxi_9";
    expect(checkJudgmentRefs(j)).toEqual(["recommendedOptionId が options に存在しません: taxi_9"]);
  });

  it("options の id の重複を検出する", () => {
    const j = cloneJudgment();
    const option = j.options[0];
    if (!option) throw new Error("fixture");
    j.options.push({ ...option, kind: "taxi", label: "タクシー" });
    expect(checkJudgmentRefs(j)).toEqual(["options の id が重複しています: transfer_1"]);
  });

  it("wait で recommendedOptionId が null なら問題なし", () => {
    const j = cloneJudgment();
    j.action = "wait";
    j.recommendedOptionId = null;
    expect(checkJudgmentRefs(j)).toEqual([]);
  });
});

describe("RouteLegSchema", () => {
  it("駅 ID と路線 ID を省略できる", () => {
    const leg = { mode: "walk", from: "甲", to: "乙", minutes: 3 };
    expect(RouteLegSchema.safeParse(leg).success).toBe(true);
  });

  it("駅 ID と路線 ID を持てる", () => {
    const leg = {
      mode: "ride",
      from: "甲",
      to: "乙",
      minutes: 10,
      line: "架空線",
      fromStationId: "op.line.甲",
      toStationId: "op.line.乙",
      lineId: "op.line",
    };
    expect(RouteLegSchema.parse(leg)).toEqual(leg);
  });
});

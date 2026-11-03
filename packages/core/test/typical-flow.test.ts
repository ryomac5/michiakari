import { join } from "node:path";
import type { Knowledge } from "@repo/schema";
import { TypicalFlowSchema } from "@repo/schema";
import { findRepoRoot, loadKnowledgeDir } from "@repo/schema/loaders";
import { describe, expect, it } from "vitest";
import {
  PREDICTABILITY_HIGH_MAX_RATIO,
  PREDICTABILITY_MEDIUM_MAX_RATIO,
} from "../params/estimation.ts";
import { estimateBranchAwareRemaining } from "../src/remaining-paths.ts";
import {
  describeTypicalFlow,
  estimateUntilResume,
  inferPredictabilityLevel,
} from "../src/typical-flow.ts";
import { buildKnowledge, constantKnowledge, lognormalKnowledge } from "./fixtures/knowledge.ts";

const DEV_KNOWLEDGE_DIR = join(
  findRepoRoot(),
  "packages/schema/test/fixtures/dev-content/knowledge",
);

function loadDevKnowledge(id: string): Knowledge {
  const entry = loadKnowledgeDir(DEV_KNOWLEDGE_DIR).entries.find((e) => e.data.id === id);
  if (!entry) throw new Error(`ダミーの知見がありません: ${id}`);
  return entry.data;
}

describe("describeTypicalFlow", () => {
  it("ダミーの人身事故は知見に書かれた high と下限 60 分を返す", () => {
    const knowledge = loadDevKnowledge("person_accident");
    const flow = describeTypicalFlow(knowledge);
    expect(flow.predictability.level).toBe("high");
    expect(flow.predictability.source).toBe("knowledge");
    expect(flow.predictability.basis).toEqual(knowledge.predictability?.basis);
    expect(flow.typicalFloorMinutes).toBe(60);
    expect(TypicalFlowSchema.parse(flow)).toEqual(flow);
  });

  // 下限を当てるようにしたので、比べる側も発生直後（経過 0 分）として下限を当てる
  it("再開の見込みは既存の残り時間の計算を段階と発生の経過 0 分で呼んだ値と一致する", () => {
    const knowledge = loadDevKnowledge("person_accident");
    const noWait: Knowledge = {
      ...knowledge,
      after_resume: { ...knowledge.after_resume, first_train_wait_minutes: { p50: 0, p80: 0 } },
    };
    const first = knowledge.phases[0]?.id ?? "";
    const expected = estimateBranchAwareRemaining(noWait, first, 0, {
      elapsedSinceOnsetMinutes: 0,
    }).remaining;
    expect(describeTypicalFlow(knowledge).untilResume).toEqual(expected);
    expect(estimateUntilResume(knowledge)).toEqual(expected);
  });

  it("ダミーの人身事故は、発生直後の再開の p50 と p80 が下限の 60 分以上になる", () => {
    const untilResume = estimateUntilResume(loadDevKnowledge("person_accident"));
    expect(untilResume.p50).toBeGreaterThanOrEqual(60);
    expect(untilResume.p80).toBeGreaterThanOrEqual(60);
  });

  it("段階の列と初列車待ちを知見のとおりに返す", () => {
    const knowledge = loadDevKnowledge("person_accident");
    const flow = describeTypicalFlow(knowledge);
    expect(flow.eventType).toBe("person_accident");
    expect(flow.phases).toEqual(
      knowledge.phases.map((p) => ({ id: p.id, name: p.name, duration: p.duration_minutes })),
    );
    expect(flow.firstTrainWait).toEqual(knowledge.after_resume.first_train_wait_minutes);
  });

  it("ダミーの車両故障と大雨は知見に書かれた level を返し、下限は null", () => {
    expect(describeTypicalFlow(loadDevKnowledge("vehicle_failure"))).toMatchObject({
      predictability: { level: "medium", source: "knowledge" },
      typicalFloorMinutes: null,
    });
    expect(describeTypicalFlow(loadDevKnowledge("heavy_rain"))).toMatchObject({
      predictability: { level: "low", source: "knowledge" },
      typicalFloorMinutes: null,
    });
  });

  it("predictability の無い知見では比から推し量った値を返す", () => {
    const flow = describeTypicalFlow(lognormalKnowledge);
    expect(flow.untilResume.p80 / flow.untilResume.p50).toBeGreaterThan(
      PREDICTABILITY_HIGH_MAX_RATIO,
    );
    expect(flow.untilResume.p80 / flow.untilResume.p50).toBeLessThanOrEqual(
      PREDICTABILITY_MEDIUM_MAX_RATIO,
    );
    expect(flow.predictability).toEqual({ level: "medium", source: "inferred", basis: null });
    expect(flow.typicalFloorMinutes).toBeNull();
  });

  it("ダミーの車両故障から predictability を外すと、分岐の幅から low と推し量る", () => {
    const { predictability: _, ...rest } = loadDevKnowledge("vehicle_failure");
    expect(describeTypicalFlow(rest).predictability).toEqual({
      level: "low",
      source: "inferred",
      basis: null,
    });
  });

  it("所要時間が一定の知見は high と推し量る", () => {
    const flow = describeTypicalFlow(constantKnowledge);
    expect(flow.untilResume).toEqual({ p50: 30, p80: 30 });
    expect(flow.predictability).toMatchObject({ level: "high", source: "inferred" });
  });

  it("幅の広い知見は low と推し量る", () => {
    const wide = buildKnowledge([{ id: "only", duration: { p50: 10, p80: 60 } }], {
      p50: 0,
      p80: 0,
    });
    expect(describeTypicalFlow(wide).predictability).toMatchObject({
      level: "low",
      source: "inferred",
    });
  });
});

describe("inferPredictabilityLevel", () => {
  it("比の閾値で high、medium、low を分ける", () => {
    const p50 = 100;
    const at = (ratio: number) => ({ p50, p80: Math.round(p50 * ratio) });
    expect(inferPredictabilityLevel(at(PREDICTABILITY_HIGH_MAX_RATIO))).toBe("high");
    expect(inferPredictabilityLevel({ p50, p80: at(PREDICTABILITY_HIGH_MAX_RATIO).p80 + 1 })).toBe(
      "medium",
    );
    expect(inferPredictabilityLevel(at(PREDICTABILITY_MEDIUM_MAX_RATIO))).toBe("medium");
    expect(
      inferPredictabilityLevel({ p50, p80: at(PREDICTABILITY_MEDIUM_MAX_RATIO).p80 + 1 }),
    ).toBe("low");
  });

  it("p50 が 0 なら p80 が 0 のときだけ high", () => {
    expect(inferPredictabilityLevel({ p50: 0, p80: 0 })).toBe("high");
    expect(inferPredictabilityLevel({ p50: 0, p80: 5 })).toBe("low");
  });
});

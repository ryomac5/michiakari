import { join } from "node:path";
import type { Knowledge } from "@repo/schema";
import { findRepoRoot, loadKnowledgeDir } from "@repo/schema/loaders";
import { describe, expect, it } from "vitest";
import {
  computeResumeFloorRemaining,
  estimateBranchAwareRemaining,
  estimateRemaining,
} from "../src/index.ts";
import { lognormalKnowledge } from "./fixtures/knowledge.ts";

// 知見の typical_floor_minutes を再開までの残りの下限として当てる計算

const DEV_KNOWLEDGE_DIR = join(
  findRepoRoot(),
  "packages/schema/test/fixtures/dev-content/knowledge",
);

function loadDevKnowledge(id: string): Knowledge {
  const entry = loadKnowledgeDir(DEV_KNOWLEDGE_DIR).entries.find((e) => e.data.id === id);
  if (!entry) throw new Error(`ダミーの知見がありません: ${id}`);
  return entry.data;
}

const personAccident = loadDevKnowledge("person_accident");
const firstPhase = personAccident.phases[0]?.id ?? "";
const firstTrainWait = personAccident.after_resume.first_train_wait_minutes;

function withFloor(knowledge: Knowledge, floor: number): Knowledge {
  return {
    ...knowledge,
    predictability: { level: "high", basis: { ja: "架空" }, typical_floor_minutes: floor },
  };
}

describe("computeResumeFloorRemaining", () => {
  it("下限から発生からの経過を差し引く", () => {
    expect(computeResumeFloorRemaining(personAccident, 0)).toBe(60);
    expect(computeResumeFloorRemaining(personAccident, 25)).toBe(35);
  });

  it("下限を過ぎたら 0、下限の無い知見は 0", () => {
    expect(computeResumeFloorRemaining(personAccident, 90)).toBe(0);
    expect(computeResumeFloorRemaining(lognormalKnowledge, 0)).toBe(0);
  });

  it("経過が負や有限でなければ例外", () => {
    expect(() => computeResumeFloorRemaining(personAccident, -1)).toThrow(RangeError);
    expect(() => computeResumeFloorRemaining(personAccident, Number.NaN)).toThrow(RangeError);
  });
});

describe("estimateBranchAwareRemaining の下限", () => {
  it("ダミーの人身事故は、発生直後の再開までの p50 が 60 分以上になる", () => {
    const withOnset = estimateBranchAwareRemaining(personAccident, firstPhase, 0, {
      elapsedSinceOnsetMinutes: 0,
    }).remaining;
    const without = estimateBranchAwareRemaining(personAccident, firstPhase, 0).remaining;
    // 乗れるまでの残りは、再開までの下限に初列車待ちを足した値を下回らない
    expect(withOnset.p50).toBeGreaterThanOrEqual(60 + firstTrainWait.p50);
    expect(withOnset.p80).toBeGreaterThanOrEqual(60 + firstTrainWait.p50);
    // 段階を飛ばす最短の道だけでは下限を下回っていた
    expect(without.p50 - firstTrainWait.p50).toBeLessThan(60);
  });

  it("下限より短い側だけを切り上げ、長い側は短くならない", () => {
    const floored = estimateBranchAwareRemaining(personAccident, firstPhase, 0, {
      elapsedSinceOnsetMinutes: 0,
    }).remaining;
    const plain = estimateBranchAwareRemaining(personAccident, firstPhase, 0).remaining;
    expect(floored.p50).toBeGreaterThan(plain.p50);
    expect(floored.p80).toBeGreaterThanOrEqual(plain.p80);
    expect(floored.p80).toBeGreaterThan(floored.p50);
  });

  it("発生からの経過を差し引く。下限を過ぎたあとは下限が無いときと同じ", () => {
    const at20 = estimateBranchAwareRemaining(personAccident, firstPhase, 20, {
      elapsedSinceOnsetMinutes: 20,
    }).remaining;
    expect(at20.p50).toBeGreaterThanOrEqual(40 + firstTrainWait.p50);
    const late = { elapsedSinceOnsetMinutes: 60 };
    expect(estimateBranchAwareRemaining(personAccident, firstPhase, 60, late)).toEqual(
      estimateBranchAwareRemaining(personAccident, firstPhase, 60),
    );
  });

  it("下限の無い知見では、発生からの経過を与えても結果が変わらない", () => {
    for (const elapsed of [0, 10, 45]) {
      expect(
        estimateBranchAwareRemaining(lognormalKnowledge, "initial", 0, {
          elapsedSinceOnsetMinutes: elapsed,
        }),
      ).toEqual(estimateBranchAwareRemaining(lognormalKnowledge, "initial", 0));
    }
    const vehicleFailure = loadDevKnowledge("vehicle_failure");
    const first = vehicleFailure.phases[0]?.id ?? "";
    expect(
      estimateBranchAwareRemaining(vehicleFailure, first, 0, { elapsedSinceOnsetMinutes: 0 }),
    ).toEqual(estimateBranchAwareRemaining(vehicleFailure, first, 0));
  });
});

describe("estimateRemaining の下限", () => {
  it("下限 0 は既定と同じ", () => {
    expect(estimateRemaining(lognormalKnowledge, "working", 5, { resumeFloorMinutes: 0 })).toEqual(
      estimateRemaining(lognormalKnowledge, "working", 5),
    );
  });

  it("下限が分布の大半より長いと、p50 は下限と初列車待ちの和に寄る", () => {
    const knowledge = withFloor(lognormalKnowledge, 200);
    const result = estimateRemaining(knowledge, "initial", 0, { resumeFloorMinutes: 200 });
    expect(result.p50).toBeGreaterThan(200);
    expect(result.p80).toBeGreaterThanOrEqual(result.p50);
  });

  it("下限が負や有限でなければ例外", () => {
    expect(() =>
      estimateRemaining(lognormalKnowledge, "initial", 0, { resumeFloorMinutes: -1 }),
    ).toThrow(RangeError);
  });
});

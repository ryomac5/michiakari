import { type Knowledge, KnowledgeSchema } from "@repo/schema";
import { describe, expect, it } from "vitest";
import {
  enumeratePhasePaths,
  estimateBranchAwareRemaining,
  estimateRemaining,
  estimateStatedRemaining,
  findPhasePaths,
} from "../src/index.ts";
import { lognormalKnowledge } from "./fixtures/knowledge.ts";

// 架空の分岐する知見。段階 b は長引くときだけ通り、a から c へ飛べる
const branchingKnowledge: Knowledge = KnowledgeSchema.parse({
  id: "fictional_branch",
  name: { ja: "架空の分岐" },
  summary: { ja: "テスト用" },
  identification: { phrases: ["架空"] },
  phases: [
    {
      id: "a",
      name: { ja: "a" },
      description: "a",
      signals: [
        { id: "sig_a", observable_from: ["announcement"], description: "a", example_phrases: [] },
      ],
      duration_minutes: { p50: 10, p80: 20 },
      exit_signals: ["sig_b", "sig_c"],
      guidance: { ja: "a" },
    },
    {
      id: "b",
      name: { ja: "b" },
      description: "b",
      signals: [
        { id: "sig_b", observable_from: ["announcement"], description: "b", example_phrases: [] },
      ],
      duration_minutes: { p50: 40, p80: 70 },
      exit_signals: ["sig_c"],
      guidance: { ja: "b" },
    },
    {
      id: "c",
      name: { ja: "c" },
      description: "c",
      signals: [
        { id: "sig_c", observable_from: ["announcement"], description: "c", example_phrases: [] },
      ],
      duration_minutes: { p50: 5, p80: 10 },
      exit_signals: [],
      guidance: { ja: "c" },
    },
  ],
  after_resume: { first_train_wait_minutes: { p50: 5, p80: 15 }, notes: "架空" },
  caveats: [],
  external_factors: { weather: false, notes: "なし" },
});

type BranchSpec = { id: string; p50: number; p80: number; exits: string[] };

// 段階ごとに兆候を 1 つ持つ架空の知見を作る。兆候の id は sig_<段階の id>
function buildBranchKnowledge(specs: readonly BranchSpec[]): Knowledge {
  return KnowledgeSchema.parse({
    id: "fictional_tree",
    name: { ja: "架空の分岐" },
    summary: { ja: "テスト用" },
    identification: { phrases: ["架空"] },
    phases: specs.map((p) => ({
      id: p.id,
      name: { ja: p.id },
      description: p.id,
      signals: [
        {
          id: `sig_${p.id}`,
          observable_from: ["announcement"],
          description: p.id,
          example_phrases: [],
        },
      ],
      duration_minutes: { p50: p.p50, p80: p.p80 },
      exit_signals: p.exits.map((e) => `sig_${e}`),
      guidance: { ja: p.id },
    })),
    after_resume: { first_train_wait_minutes: { p50: 5, p80: 15 }, notes: "架空" },
    caveats: [],
    external_factors: { weather: false, notes: "なし" },
  });
}

// 初動から短い処置と長い救援に分かれる。最も先の段階へ跳ぶと長い救援を通ってしまう形
const treeKnowledge = buildBranchKnowledge([
  { id: "initial", p50: 5, p80: 15, exits: ["repair", "rescue"] },
  { id: "repair", p50: 15, p80: 30, exits: ["done", "rescue"] },
  { id: "rescue", p50: 40, p80: 70, exits: ["done"] },
  { id: "done", p50: 5, p80: 15, exits: ["done"] },
]);

describe("enumeratePhasePaths と findPhasePaths", () => {
  it("フォールスルーと exit_signals の跳び先をすべて候補にして経路を列挙する", () => {
    expect(enumeratePhasePaths(treeKnowledge, 0)).toEqual([
      [0, 1, 2, 3],
      [0, 1, 3],
      [0, 2, 3],
    ]);
  });

  it("p50 の合計が最小の経路と最大の経路を選ぶ。最も先へ跳ぶ経路を選ばない", () => {
    expect(findPhasePaths(treeKnowledge, 0)).toEqual({
      shortest: [0, 1, 3],
      longest: [0, 1, 2, 3],
    });
    expect(findPhasePaths(treeKnowledge, 1)).toEqual({ shortest: [1, 3], longest: [1, 2, 3] });
    expect(findPhasePaths(branchingKnowledge, 0)).toEqual({ shortest: [0, 2], longest: [0, 1, 2] });
  });

  it("exit_signals が無ければ次の段階へ進む", () => {
    expect(enumeratePhasePaths(lognormalKnowledge, 0)).toEqual([[0, 1, 2]]);
  });

  it("存在しない位置は例外", () => {
    expect(() => enumeratePhasePaths(lognormalKnowledge, 5)).toThrow(RangeError);
  });
});

describe("estimateBranchAwareRemaining", () => {
  it("分岐しない知見では estimateRemaining と同じ", () => {
    const result = estimateBranchAwareRemaining(lognormalKnowledge, "working", 5);
    expect(result.remaining).toEqual(estimateRemaining(lognormalKnowledge, "working", 5));
    expect(result.skippedPhaseIds).toEqual([]);
  });

  it("p50 は省ける段階を省き、p80 はすべての段階を通る", () => {
    const result = estimateBranchAwareRemaining(branchingKnowledge, "a", 0);
    const full = estimateRemaining(branchingKnowledge, "a", 0);
    const short = estimateRemaining(
      { ...branchingKnowledge, phases: branchingKnowledge.phases.filter((p) => p.id !== "b") },
      "a",
      0,
    );
    expect(result.skippedPhaseIds).toEqual(["b"]);
    expect(result.remaining.p50).toBe(short.p50);
    expect(result.remaining.p80).toBe(full.p80);
    expect(result.remaining.p50).toBeLessThan(full.p50);
  });
});

describe("estimateBranchAwareRemaining の分岐", () => {
  it("短い分岐を p50 に、長い分岐を p80 に使う", () => {
    const result = estimateBranchAwareRemaining(treeKnowledge, "initial", 0);
    const pick = (ids: string[]) => ({
      ...treeKnowledge,
      phases: treeKnowledge.phases.filter((p) => ids.includes(p.id)),
    });
    const short = estimateRemaining(pick(["initial", "repair", "done"]), "initial", 0);
    const viaRescueOnly = estimateRemaining(pick(["initial", "rescue", "done"]), "initial", 0);
    const full = estimateRemaining(treeKnowledge, "initial", 0);
    expect(result.skippedPhaseIds).toEqual(["rescue"]);
    expect(result.remaining.p50).toBe(short.p50);
    expect(result.remaining.p50).toBeLessThan(viaRescueOnly.p50);
    expect(result.remaining.p80).toBe(full.p80);
  });
});

describe("estimateStatedRemaining", () => {
  it("見込み時刻までの分に初列車待ちの p50・p80 を足す", () => {
    expect(
      estimateStatedRemaining(
        branchingKnowledge,
        "2026-11-05T22:50:00+09:00",
        "2026-11-05T22:32:00+09:00",
      ),
    ).toEqual({ p50: 23, p80: 33 });
  });

  it("端数は切り上げ、過ぎた見込み時刻は 0 分として扱う", () => {
    expect(
      estimateStatedRemaining(
        branchingKnowledge,
        "2026-11-05T22:50:00+09:00",
        "2026-11-05T22:49:30+09:00",
      ),
    ).toEqual({ p50: 6, p80: 16 });
    expect(
      estimateStatedRemaining(
        branchingKnowledge,
        "2026-11-05T22:50:00+09:00",
        "2026-11-05T23:00:00+09:00",
      ),
    ).toEqual({ p50: 5, p80: 15 });
  });
});

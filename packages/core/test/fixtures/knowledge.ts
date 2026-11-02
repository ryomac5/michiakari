import { type DurationDist, type Knowledge, KnowledgeSchema } from "@repo/schema";

// テスト用の架空ナレッジ。実在の事象・数値とは無関係

type PhaseSpec = { id: string; duration: DurationDist };

// 段階の所要時間と初列車待ちだけを変えた架空ナレッジを作る
export function buildKnowledge(
  phases: readonly PhaseSpec[],
  firstTrainWait: DurationDist,
): Knowledge {
  return KnowledgeSchema.parse({
    id: "fictional_event",
    name: { ja: "架空の事象" },
    summary: { ja: "テスト用の架空の事象。" },
    identification: { phrases: ["架空の確認"] },
    phases: phases.map((p) => ({
      id: p.id,
      name: { ja: `架空の段階 ${p.id}` },
      description: "架空の段階",
      signals: [],
      duration_minutes: p.duration,
      exit_signals: [],
      guidance: { ja: "架空の案内" },
    })),
    after_resume: { first_train_wait_minutes: firstTrainWait, notes: "架空のメモ" },
    caveats: [],
    external_factors: { weather: false, notes: "なし" },
  });
}

// 3 段階の対数正規
export const lognormalKnowledge = buildKnowledge(
  [
    { id: "initial", duration: { p50: 10, p80: 20 } },
    { id: "working", duration: { p50: 20, p80: 40 } },
    { id: "recovering", duration: { p50: 15, p80: 25 } },
  ],
  { p50: 5, p80: 15 },
);

// すべて p50 = p80 の定数
export const constantKnowledge = buildKnowledge(
  [
    { id: "first", duration: { p50: 10, p80: 10 } },
    { id: "second", duration: { p50: 20, p80: 20 } },
  ],
  { p50: 5, p80: 5 },
);

// すべて 0 分
export const zeroKnowledge = buildKnowledge([{ id: "only", duration: { p50: 0, p80: 0 } }], {
  p50: 0,
  p80: 0,
});

// 1 段階の対数正規。初列車待ちは 0 分
export const singlePhaseKnowledge = buildKnowledge(
  [{ id: "only", duration: { p50: 10, p80: 20 } }],
  { p50: 0, p80: 0 },
);

// p50 が 0 で p80 が正
export const zeroMedianKnowledge = buildKnowledge([{ id: "only", duration: { p50: 0, p80: 10 } }], {
  p50: 0,
  p80: 0,
});

// 分岐点の例。段階 {10,20}、初列車待ち {10,15}
export const resumeExampleKnowledge = buildKnowledge(
  [{ id: "only", duration: { p50: 10, p80: 20 } }],
  { p50: 10, p80: 15 },
);

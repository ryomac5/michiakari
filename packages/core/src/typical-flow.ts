import type {
  DurationDist,
  Knowledge,
  PredictabilityLevel,
  TypicalFlow,
  TypicalFlowPredictability,
} from "@repo/schema";
import {
  PREDICTABILITY_HIGH_MAX_RATIO,
  PREDICTABILITY_MEDIUM_MAX_RATIO,
  SHORT_FLOW_MAX_MINUTES,
} from "../params/estimation.ts";
import { getFirstTrainWait } from "./remaining.ts";
import { estimateBranchAwareRemaining } from "./remaining-paths.ts";

// 事象ごとの「よくある流れ」と「見込みの立てやすさ」をまとめる

// 再開後の初列車待ちを 0 分にした知見を作る。発生から運転再開までだけを見積もるため
function withoutFirstTrainWait(knowledge: Knowledge): Knowledge {
  return {
    ...knowledge,
    after_resume: { ...knowledge.after_resume, first_train_wait_minutes: { p50: 0, p80: 0 } },
  };
}

// 発生から運転再開までの p50・p80。既存の残り時間の計算を最初の段階・経過 0 分で呼ぶ
// 判断と同じく分岐を考える。p50 は最短の経路、p80 は最長の経路で求める。知見の下限も当てる
export function estimateUntilResume(knowledge: Knowledge): DurationDist {
  const firstPhase = knowledge.phases[0];
  if (!firstPhase) throw new RangeError(`知見 ${knowledge.id} に段階がありません`);
  return estimateBranchAwareRemaining(withoutFirstTrainWait(knowledge), firstPhase.id, 0, {
    elapsedSinceOnsetMinutes: 0,
  }).remaining;
}

// 再開までの p80 と p50 の比から見込みの立てやすさを推し量る。p50 が 0 なら p80 が 0 のときだけ high
export function inferPredictabilityLevel(untilResume: DurationDist): PredictabilityLevel {
  if (untilResume.p50 === 0) return untilResume.p80 === 0 ? "high" : "low";
  const ratio = untilResume.p80 / untilResume.p50;
  if (ratio <= PREDICTABILITY_HIGH_MAX_RATIO) return "high";
  if (ratio <= PREDICTABILITY_MEDIUM_MAX_RATIO) return "medium";
  return "low";
}

// 知見に書かれていればそれを使い、無ければ比から推し量る
function resolvePredictability(
  knowledge: Knowledge,
  untilResume: DurationDist,
): TypicalFlowPredictability {
  const stated = knowledge.predictability;
  if (stated) return { level: stated.level, source: "knowledge", basis: stated.basis };
  return { level: inferPredictabilityLevel(untilResume), source: "inferred", basis: null };
}

// 知見ごとの結果の控え。知見だけで決まり、判断のたびに標本を作り直す必要が無いため
const typicalFlowCache = new WeakMap<Knowledge, TypicalFlow>();

// 知見から段階の列、再開までの見込み、見込みの立てやすさ、目安の下限を返す
export function describeTypicalFlow(knowledge: Knowledge): TypicalFlow {
  const cached = typicalFlowCache.get(knowledge);
  if (cached) return cached;
  const untilResume = estimateUntilResume(knowledge);
  const flow: TypicalFlow = {
    eventType: knowledge.id,
    phases: knowledge.phases.map((p) => ({ id: p.id, name: p.name, duration: p.duration_minutes })),
    untilResume,
    firstTrainWait: getFirstTrainWait(knowledge),
    predictability: resolvePredictability(knowledge, untilResume),
    typicalFloorMinutes: knowledge.predictability?.typical_floor_minutes ?? null,
  };
  typicalFlowCache.set(knowledge, flow);
  return flow;
}

// short: 短く終わり、慌てず待てる。long: 時間はかかるが、見込みは立てやすい
// 見込みが立てやすい事象でなければ null
export type FlowOutlook = "short" | "long";

export function classifyFlowOutlook(flow: TypicalFlow | null): FlowOutlook | null {
  if (flow?.predictability.level !== "high") return null;
  return flow.untilResume.p80 <= SHORT_FLOW_MAX_MINUTES ? "short" : "long";
}

import type { Confidence, IncidentCause, Observation } from "@repo/schema";
import { INCIDENT_BEHAVIOR, type StopKind } from "../params/incident-behavior.ts";
import {
  INCIDENT_TYPE_DURATIONS,
  INCIDENT_TYPE_IDS,
  type IncidentTypeId,
} from "../params/incident-durations.ts";

// 止まり方の区別。種類ごとの止まり方は params/incident-behavior.ts の規則表 1 か所にまとめ、web と agent が同じ表を引く
// 出典: 開発者の推定。社内規程の数値や手順ではない

export type { StopKind } from "../params/incident-behavior.ts";

// 画面と判断で使う止まり方。train は見合わせと言わず停車中と伝える
export type StopScope = "train" | "section";

// 種類ごとの止まり方。規則表から引いた表を再輸出する
export const STOP_KIND_BY_INCIDENT_TYPE: Readonly<Record<IncidentTypeId, StopKind>> =
  Object.fromEntries(INCIDENT_TYPE_IDS.map((t) => [t, INCIDENT_BEHAVIOR[t].stopKind])) as Record<
    IncidentTypeId,
    StopKind
  >;

// 知見の事象から種類を引く。docs/research/rail-suspensions/taxonomy.json の existing_model_id の逆引き
// 車両故障の事象は発煙確認も含むが、どちらも同じ止まり方なので故障に寄せる
export const INCIDENT_TYPE_BY_EVENT_TYPE: Readonly<Record<string, IncidentTypeId>> = {
  person_accident: "person_collision",
  in_car_response: "medical_response",
  vehicle_failure: "vehicle_failure",
  heavy_rain: "heavy_rain",
};

export function findIncidentType(id: string | null | undefined): IncidentTypeId | null {
  if (!id) return null;
  const mapped = INCIDENT_TYPE_BY_EVENT_TYPE[id];
  if (mapped) return mapped;
  return INCIDENT_TYPE_IDS.find((t) => t === id) ?? null;
}

// 大分類の中の種類がみな同じ止まり方なら、その止まり方を返す。混ざっていれば null
function resolveGroupStopKind(group: string): StopKind | null {
  const kinds = new Set(
    INCIDENT_TYPE_IDS.filter((t) => INCIDENT_TYPE_DURATIONS[t].groupId === group).map(
      (t) => STOP_KIND_BY_INCIDENT_TYPE[t],
    ),
  );
  const [only] = kinds;
  return kinds.size === 1 && only ? only : null;
}

// 事象と入口の原因から止まり方を引く。知見の事象を先に使い、無ければ原因の種類、大分類の順に使う
export function resolveStopKind(
  eventType: string | null | undefined,
  cause: IncidentCause | null | undefined,
): StopKind {
  const type = findIncidentType(eventType) ?? findIncidentType(cause?.type);
  if (type) return STOP_KIND_BY_INCIDENT_TYPE[type];
  return (cause ? resolveGroupStopKind(cause.group) : null) ?? "section";
}

export type StopScopeInput = {
  eventType?: string | null;
  cause?: IncidentCause | null;
  // 発表に止まっている区間があるか
  sectionAnnounced?: boolean;
};

// 画面と判断で使う止まり方を決める。その列車から止まる故障は、発表に区間が出るまで train とする
export function resolveStopScope(input: StopScopeInput): StopScope {
  const kind = resolveStopKind(input.eventType, input.cause);
  if (kind === "train_only") return "train";
  if (kind === "train_first") return input.sectionAnnounced ? "section" : "train";
  return "section";
}

const CONFIDENCE_SCORE: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

// 観測の候補を確信度で重みづけして事象を選ぶ。知見のある事象だけを数え、同点なら新しい観測を優先する
// web と agent が同じこの関数で選ぶ
export function selectObservedEventType(
  observations: readonly Observation[],
  isKnownEvent: (eventType: string) => boolean,
): string | null {
  const scores = new Map<string, { score: number; lastIndex: number }>();
  observations.forEach((o, index) => {
    for (const c of o.eventTypeCandidates) {
      if (!isKnownEvent(c.eventType)) continue;
      const prev = scores.get(c.eventType) ?? { score: 0, lastIndex: -1 };
      scores.set(c.eventType, {
        score: prev.score + CONFIDENCE_SCORE[c.confidence],
        lastIndex: index,
      });
    }
  });
  let best: { eventType: string; score: number; lastIndex: number } | null = null;
  for (const [eventType, s] of scores) {
    if (!best || s.score > best.score || (s.score === best.score && s.lastIndex > best.lastIndex)) {
      best = { eventType, ...s };
    }
  }
  return best?.eventType ?? null;
}

export type ObservedStopScopeInput = {
  // 判断の推定が決めた事象。まだ無ければ観測の候補から選ぶ
  estimatedEventType?: string | null;
  observations: readonly Observation[];
  isKnownEvent: (eventType: string) => boolean;
  cause?: IncidentCause | null;
};

// 観測と入口の原因から止まり方を決める。web と agent が同じこの関数を呼ぶ
export function resolveObservedStopScope(input: ObservedStopScopeInput): StopScope {
  return resolveStopScope({
    eventType:
      input.estimatedEventType || selectObservedEventType(input.observations, input.isKnownEvent),
    cause: input.cause ?? null,
    sectionAnnounced: input.observations.some((o) => o.section !== null),
  });
}

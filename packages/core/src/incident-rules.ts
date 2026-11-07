import type { Confidence, DurationDist, IncidentCause, ProtectionBroadcast } from "@repo/schema";
import type { AnnouncementCueId } from "../params/announcement-cues.ts";
import {
  INCIDENT_BEHAVIOR,
  type IncidentFlowOutlook,
  UNKNOWN_FIRST_TRAIN_WAIT,
  VERY_LONG_WEATHER_PHRASES,
} from "../params/incident-behavior.ts";
import {
  INCIDENT_TYPE_DURATIONS,
  INCIDENT_TYPE_IDS,
  type IncidentTypeId,
} from "../params/incident-durations.ts";
import { INCIDENT_PHRASES } from "../params/incident-phrases.ts";
import type { IncidentEstimateBasis } from "./incident-estimate.ts";
import { findIncidentType } from "./stop-scope.ts";

// 種類ごとの振る舞いの規則表を引く。判断の材料は規則表、統計値、利用者が持ち込んだ発表に限る

export type IncidentTypeInput = {
  // 観測や判断が決めた事象。統計値の種類の id か、以前の知見の事象の id
  eventType?: string | null;
  // 入口で利用者が答えた原因
  cause?: IncidentCause | null;
  // 発表や放送の文。呼び名から種類を拾う
  texts?: readonly string[];
};

// 文に含まれる呼び名から種類を拾う。いちばん長い呼び名に当たった種類を選ぶ。無ければ null
export function findIncidentTypeByPhrase(text: string): IncidentTypeId | null {
  let best: { type: IncidentTypeId; length: number } | null = null;
  for (const type of INCIDENT_TYPE_IDS) {
    for (const phrase of INCIDENT_PHRASES[type]) {
      if (text.includes(phrase) && (!best || phrase.length > best.length)) {
        best = { type, length: phrase.length };
      }
    }
  }
  return best?.type ?? null;
}

// 事象、入口の原因、発表の呼び名の順に種類を決める。どれでも決まらなければ null
export function resolveIncidentType(input: IncidentTypeInput): IncidentTypeId | null {
  const direct = findIncidentType(input.eventType) ?? findIncidentType(input.cause?.type);
  if (direct) return direct;
  for (const text of input.texts ?? []) {
    const found = findIncidentTypeByPhrase(text);
    if (found) return found;
  }
  return null;
}

function checkVeryLongWeatherText(texts: readonly string[]): boolean {
  return texts.some((t) =>
    VERY_LONG_WEATHER_PHRASES.some((p) => t.toLowerCase().includes(p.toLowerCase())),
  );
}

// 種類の長さの見込み。種類が分からなければ unknown
// 天気の事象か種類が分からないときに、台風の語が発表にあれば very_long に上げる
export function resolveFlowOutlook(
  type: IncidentTypeId | null,
  texts: readonly string[] = [],
): IncidentFlowOutlook {
  const weatherOrUnknown = type === null || checkWeatherIncident(type);
  if (weatherOrUnknown && checkVeryLongWeatherText(texts)) return "very_long";
  return type ? INCIDENT_BEHAVIOR[type].flowOutlook : "unknown";
}

// 再開から乗れる列車が来るまでの分。種類が分からなければ区間が止まるものとみなす
export function resolveFirstTrainWait(type: IncidentTypeId | null): DurationDist {
  return type ? INCIDENT_BEHAVIOR[type].firstTrainWait : UNKNOWN_FIRST_TRAIN_WAIT;
}

// 天気の事象か。統計値の大分類が weather の種類
export function checkWeatherIncident(type: IncidentTypeId | null): boolean {
  return type !== null && INCIDENT_TYPE_DURATIONS[type].groupId === "weather";
}

export type ProtectionIncidentInput = {
  type: IncidentTypeId | null;
  cues: readonly AnnouncementCueId[];
  // 入口で答えた受信の放送の有無。聞かなかったと答えても、必ず出す種類は防護無線の事象のままとする
  protectionBroadcast?: ProtectionBroadcast | null;
};

// 防護無線の事象か。必ず出す種類か、受信の放送が聞こえたら true。出すことがある種類は放送で決める
export function checkProtectionIncident(input: ProtectionIncidentInput): boolean {
  if (input.cues.includes("protection_received") || input.protectionBroadcast === "heard")
    return true;
  return input.type !== null && INCIDENT_BEHAVIOR[input.type].protection === "always";
}

export type RuleConfidenceInput = {
  type: IncidentTypeId | null;
  // estimateIncidentRemaining の basis。見込みが無ければ null
  basis: IncidentEstimateBasis | null;
  cues: readonly AnnouncementCueId[];
  // 発表の再開見込みが以前より後ろへずれたか
  statedExtended?: boolean;
};

const RESUME_APPROACH_CUES: readonly AnnouncementCueId[] = ["resume_soon", "track_cleared"];

// 見込みの確信度。再開と発表は高く、規則と再開が近い手がかりは中、それ以外は低い
export function decideRuleConfidence(input: RuleConfidenceInput): Confidence {
  switch (input.basis) {
    case "resumed":
      return "high";
    case "stated":
      return input.statedExtended ? "medium" : "high";
    case "rule":
      return input.type ? "medium" : "low";
    case "statistics":
      return input.cues.some((c) => RESUME_APPROACH_CUES.includes(c)) ? "medium" : "low";
    default:
      return "low";
  }
}

import type { IncidentCause } from "@repo/schema";
import {
  INCIDENT_TYPE_DURATIONS,
  INCIDENT_TYPE_IDS,
  type IncidentTypeId,
} from "../params/incident-durations.ts";

// 止まり方の区別。種類ごとの止まり方はこのファイルの表 1 か所にまとめ、web と agent が同じ表を引く
// 出典: 経験からの目安。社内規程の数値や手順ではない

// 種類ごとの止まり方
// train_only: その列車だけが止まる。車内の対応が済めばすぐ動く
// train_first: その列車から止まり、後ろの列車が詰まる。発表で区間が出れば区間の見合わせになる
// section: 周りの列車も止まり、区間が止まる
export type StopKind = "train_only" | "train_first" | "section";

// 画面と判断で使う止まり方。train は見合わせと言わず停車中と伝える
export type StopScope = "train" | "section";

// 分からない種類は区間を止めるものとみなす
const STOP_KIND_BY_INCIDENT_TYPE: Readonly<Record<IncidentTypeId, StopKind>> = {
  // 周りの列車も止める事象
  person_collision: "section",
  track_intrusion: "section",
  crossing_obstruction: "section",
  track_structure_damage: "section",
  building_falling_object: "section",
  track_smoke_check: "section",
  crossing_collision: "section",
  derailment: "section",
  onboard_fire: "section",
  // 周りの列車も止めることがある事象
  vegetation_obstruction: "section",
  foreign_object: "section",
  animal_collision: "section",
  bridge_impact: "section",
  // 車内の対応。急病人は次の駅で駅員に引き継ぎ、すぐ動く
  medical_response: "train_only",
  passenger_conflict: "train_only",
  // 駅で止めて確かめる。周りへの広がりは分からないので区間とみなす
  suspicious_object: "section",
  // その列車から止まる故障
  vehicle_failure: "train_first",
  vehicle_smoke: "train_first",
  signal_failure: "train_first",
  point_failure: "train_first",
  // 大雨と強風は区間ごとに上下とも止まる。地震は揺れた所が止まる
  heavy_rain: "section",
  strong_wind: "section",
  earthquake: "section",
  // 止まり方が分からない種類
  power_outage: "section",
  heat_rail_deformation: "section",
  lightning: "section",
  snow_ice: "section",
};

// 知見の事象から種類を引く。docs/research/rail-suspensions/taxonomy.json の existing_model_id の逆引き
// 車両故障の事象は発煙確認も含むが、どちらも同じ止まり方なので故障に寄せる
const INCIDENT_TYPE_BY_EVENT_TYPE: Readonly<Record<string, IncidentTypeId>> = {
  person_accident: "person_collision",
  in_car_response: "medical_response",
  vehicle_failure: "vehicle_failure",
  heavy_rain: "heavy_rain",
};

function findIncidentType(id: string | null | undefined): IncidentTypeId | null {
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

import {
  checkWeatherIncident,
  detectObservationCues,
  findIncidentType,
  INCIDENT_GROUP_IDS,
  type IncidentGroupId,
  type IncidentTypeId,
  resolveIncidentType,
  selectObservedEventType,
} from "@repo/core";
import {
  ANNOUNCEMENT_CUE_IDS,
  type AnnouncementCueId,
  AnnouncementCueIdSchema,
  type IncidentCause,
  type Observation,
} from "@repo/schema";

// 観測の列から事象の種類と手がかりを決める。見込みの計算は core が受け持つ

// 統計値の種類の id か、以前の知見の事象の id なら true
export function checkKnownIncidentType(id: string): boolean {
  return findIncidentType(id) !== null;
}

// 観測の候補から事象を選ぶ。選び方は core の 1 か所にあり、画面も同じ関数を使う
export function selectEventType(observations: readonly Observation[]): string | null {
  return selectObservedEventType(observations, checkKnownIncidentType);
}

// 観測の候補、入口の原因、発表の呼び名の順に種類を決める。決まらなければ null
export function resolveObservedIncidentType(
  observations: readonly Observation[],
  cause: IncidentCause | null,
): IncidentTypeId | null {
  return resolveIncidentType({
    eventType: selectEventType(observations),
    cause,
    texts: listObservationTexts(observations),
  });
}

// 統計値の大分類の id なら、その大分類を返す。種類が 1 つに決まらない原因を選んだときに届く
export function findIncidentGroup(id: string): IncidentGroupId | null {
  return INCIDENT_GROUP_IDS.find((g) => g === id) ?? null;
}

// 見込みに使う原因。入口で答えた原因を先に使い、無ければ観測の候補の大分類を使う。新しい観測を優先する
export function resolveObservedCause(
  observations: readonly Observation[],
  cause: IncidentCause | null,
): IncidentCause | null {
  if (cause) return cause;
  for (const o of [...observations].reverse()) {
    for (const c of o.eventTypeCandidates) {
      const group = findIncidentGroup(c.eventType);
      if (group) return { group, type: null };
    }
  }
  return null;
}

// 天気の事象か。種類が天気の種類か、種類が分からず原因の大分類が天気なら true
export function checkWeatherCause(
  type: IncidentTypeId | null,
  cause: IncidentCause | null,
): boolean {
  return checkWeatherIncident(type) || (type === null && cause?.group === "weather");
}

// 観測の原文。種類の呼び名や台風のような長さを上げる語を見るのに使う
export function listObservationTexts(observations: readonly Observation[]): string[] {
  return observations.flatMap((o) => (o.rawText ? [o.rawText] : []));
}

// 観測の手がかり。原文と引用の照合に、解釈や選択で付いた手がかりの id を足す
export function collectObservationCues(observations: readonly Observation[]): AnnouncementCueId[] {
  const found = new Set<AnnouncementCueId>(detectObservationCues(observations));
  for (const o of observations) {
    for (const s of o.detectedSignals) {
      const cue = AnnouncementCueIdSchema.safeParse(s.signalId);
      if (cue.success) found.add(cue.data);
    }
  }
  return ANNOUNCEMENT_CUE_IDS.filter((id) => found.has(id));
}

// 発生時刻は観測から分からないので、最初の観測の時刻を発生とみなす。観測が無ければ現在
export function findOnsetTime(observations: readonly Observation[], now: string): string {
  return observations.reduce(
    (earliest, o) => (Date.parse(o.observedAt) < Date.parse(earliest) ? o.observedAt : earliest),
    now,
  );
}

export type StatedResume = {
  time: string;
  // 以前の発表より後ろへずれたか
  extended: boolean;
};

// 観測時刻の順で最後に発表された再開見込み時刻を返す
export function findLatestStatedResume(observations: readonly Observation[]): StatedResume | null {
  const stated = [...observations]
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
    .flatMap((o) => (o.statedResumeTime ? [o.statedResumeTime] : []));
  const last = stated.at(-1);
  if (!last) return null;
  const extended = stated.slice(0, -1).some((t) => Date.parse(t) < Date.parse(last));
  return { time: last, extended };
}

// 線路の安全が確かめられた兆候の判定は core の手がかりの照合にある
export { checkTrackCleared } from "@repo/core";

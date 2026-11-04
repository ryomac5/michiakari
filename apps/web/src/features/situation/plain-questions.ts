import { formatIsoWithOffset } from "@/features/judgment/time";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";

// 何も分からない人にも答えられる問いの選択肢。答えは既存の観測の型と知見の種別に結び付ける
// 新しい知見の中身は作らない。知見に無い種別の選択肢は出さない

export type CauseId = "person" | "inCar" | "vehicle" | "signal" | "rain";

// 放送の言葉と、それに当たる知見の id の候補。知見にある最初の id を使う
const causeEventTypes: { id: CauseId; eventTypes: string[] }[] = [
  { id: "person", eventTypes: ["person_accident"] },
  // 非常通報装置や車内のお客様対応。人身事故と並べ、短く終わる事象を見分けやすくする
  { id: "inCar", eventTypes: ["in_car_response"] },
  { id: "vehicle", eventTypes: ["vehicle_failure", "vehicle_inspection"] },
  { id: "signal", eventTypes: ["signal_failure", "signal_trouble"] },
  { id: "rain", eventTypes: ["heavy_rain"] },
];

export type CauseOption =
  // 決まった言葉で出す選択肢
  | { kind: "preset"; id: CauseId; eventType: string }
  // 決まった言葉に無い知見。知見の名前で出す
  | { kind: "knowledge"; id: string; eventType: string };

export function listCauseOptions(catalog: KnowledgeCatalog): CauseOption[] {
  const known = new Set(catalog.map((e) => e.id));
  const presets = causeEventTypes.flatMap(({ id, eventTypes }) => {
    const eventType = eventTypes.find((t) => known.has(t));
    return eventType ? [{ kind: "preset" as const, id, eventType }] : [];
  });
  const used = new Set(presets.map((p) => p.eventType));
  const rest = catalog
    .filter((e) => !used.has(e.id))
    .map((e) => ({ kind: "knowledge" as const, id: e.id, eventType: e.id }));
  return [...presets, ...rest];
}

// 止まってからの分。いま止まったは 0、分からなければ null
export const elapsedOptions = [
  { id: "now", minutes: 0 },
  { id: "m10", minutes: 10 },
  { id: "m30", minutes: 30 },
  { id: "unknown", minutes: null },
] as const;

export type ElapsedOption = (typeof elapsedOptions)[number];

export function findElapsedOption(id: ElapsedOption["id"]): ElapsedOption {
  return elapsedOptions.find((o) => o.id === id) ?? elapsedOptions[3];
}

// 再開の見込みを放送で言っていたか。時刻を言っていたなら、続けて時刻を選ぶ
export const resumeOptions = ["stated", "undecided", "unknown"] as const;
export type ResumeOptionId = (typeof resumeOptions)[number];

// 放送で聞いた再開見込みの時刻の候補。いまを 10 分刻みに切り上げ、そこから 10 分おきに並べる
// 放送の見込みは「23時00分頃」のように切りのよい時刻が多いので、正時と半はこの並びに必ず入る
export const resumeTimeStepMinutes = 10;
export const resumeTimeCount = 8;

export type ResumeTimeOption = { id: string; iso: string };

export function listResumeTimeOptions(now: Date): ResumeTimeOption[] {
  const step = resumeTimeStepMinutes * 60_000;
  const first = Math.ceil((now.getTime() + 1) / step) * step;
  return Array.from({ length: resumeTimeCount }, (_, i) => {
    const date = new Date(first + i * step);
    const id = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
    return { id, iso: formatIsoWithOffset(date) };
  });
}

import type { KnowledgeCatalog } from "@/features/knowledge/catalog";

// 何も分からない人にも答えられる問いの選択肢。答えは既存の観測の型と知見の種別に結び付ける
// 新しい知見の中身は作らない。知見に無い種別の選択肢は出さない

export type CauseId = "person" | "vehicle" | "signal" | "rain";

// 放送の言葉と、それに当たる知見の id の候補。知見にある最初の id を使う
const causeEventTypes: { id: CauseId; eventTypes: string[] }[] = [
  { id: "person", eventTypes: ["person_accident"] },
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

// 止まってからの分。分からなければ null
export const elapsedOptions = [
  { id: "m5", minutes: 5 },
  { id: "m15", minutes: 15 },
  { id: "m30", minutes: 30 },
  { id: "unknown", minutes: null },
] as const;

export type ElapsedOption = (typeof elapsedOptions)[number];

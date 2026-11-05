import type { KnowledgeCatalog } from "@/features/knowledge/catalog";

// 入口で聞く原因の大分類と、判断で使う知見の事象の対応。対応はこの 1 か所にまとめる
// 大分類は docs/research/rail-suspensions/taxonomy.json の 8 大分類にそろえる
// 事象は taxonomy.json の existing_model_id を手がかりにする
// 大分類の中で種類によって事象が違うときは知見なしとする。人・旅客対応と気象・自然だけは種類を 1 問聞いて絞る

export const causeCategoryIds = [
  "passenger",
  "vehicle",
  "signaling",
  "power",
  "obstruction",
  "infrastructure",
  "weather",
  "major_accident",
] as const;
export type CauseCategoryId = (typeof causeCategoryIds)[number];

export const causeKindIds = [
  "person",
  "inCar",
  "rain",
  "wind",
  "snow",
  "lightning",
  "earthquake",
  "other",
] as const;
export type CauseKindId = (typeof causeKindIds)[number];

type CauseKind = { id: CauseKindId; eventType: string | null };
type CauseCategory = { id: CauseCategoryId; eventType: string | null; kinds?: CauseKind[] };

const causeCategories: Record<CauseCategoryId, CauseCategory> = {
  // 人との接触と車内の対応は事象が違う。立ち入りや不審物は知見が無い
  passenger: {
    id: "passenger",
    eventType: null,
    kinds: [
      { id: "person", eventType: "person_accident" },
      { id: "inCar", eventType: "in_car_response" },
      { id: "other", eventType: null },
    ],
  },
  // 故障と発煙の確認は、どちらも車両故障の事象に当たる
  vehicle: { id: "vehicle", eventType: "vehicle_failure" },
  signaling: { id: "signaling", eventType: null },
  power: { id: "power", eventType: null },
  obstruction: { id: "obstruction", eventType: null },
  infrastructure: { id: "infrastructure", eventType: null },
  // 大雨だけが知見を持ち、強風や地震などは持たない
  weather: {
    id: "weather",
    eventType: null,
    kinds: [
      { id: "rain", eventType: "heavy_rain" },
      { id: "wind", eventType: null },
      { id: "snow", eventType: null },
      { id: "lightning", eventType: null },
      { id: "earthquake", eventType: null },
      { id: "other", eventType: null },
    ],
  },
  major_accident: { id: "major_accident", eventType: null },
};

// 入口の答え。分からないなら category は null。種類を聞かない大分類では kind は null
export type CauseAnswer = { category: CauseCategoryId | null; kind: CauseKindId | null };

export function needsCauseKind(category: CauseCategoryId): boolean {
  return causeCategories[category].kinds !== undefined;
}

export function listCauseKinds(category: CauseCategoryId): CauseKindId[] {
  return causeCategories[category].kinds?.map((k) => k.id) ?? [];
}

// 答えから判断で使う知見の事象を引く。知見に無い事象や、知見の無い答えは null
export function resolveCauseEventType(
  answer: CauseAnswer | null,
  catalog: KnowledgeCatalog,
): string | null {
  if (!answer?.category) return null;
  const category = causeCategories[answer.category];
  const eventType = category.kinds
    ? (category.kinds.find((k) => k.id === answer.kind)?.eventType ?? null)
    : category.eventType;
  return eventType && catalog.some((e) => e.id === eventType) ? eventType : null;
}

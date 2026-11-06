import type { KnowledgeCatalog } from "@/features/knowledge/catalog";

// 入口で聞く原因の大分類と、判断で使う知見の事象の対応。対応はこの 1 か所にまとめる
// 大分類は docs/research/rail-suspensions/taxonomy.json の 8 大分類にそろえる
// 事象は taxonomy.json の existing_model_id を手がかりにする
// 大分類の中で種類によって事象が違うときは知見なしとする。気象・自然だけは種類を 1 問聞いて絞る
// 人身事故と車内の急病人は事象の大きさが違うので、統計の大分類は人・旅客対応のまま、画面の最初の選択肢だけ分ける
// 線路への立ち入りなど、ほかの人・旅客対応は選択肢を足さず、分からないと同じ知見なしの流れにする

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
// 続けて聞く種類。人身事故と車内の急病人は最初の選択肢で選ぶので含めない
export type AskedKindId = Exclude<CauseKindId, "person" | "inCar">;

export function isAskedKind(kind: CauseKindId | null): kind is AskedKindId {
  return kind !== null && kind !== "person" && kind !== "inCar";
}

type CauseKind = { id: CauseKindId; eventType: string | null };
type CauseCategory = {
  id: CauseCategoryId;
  eventType: string | null;
  kinds?: CauseKind[];
  // 種類を最初の選択肢で選び終えているときは、続けて聞かない
  kindChosenFirst?: boolean;
};

const causeCategories: Record<CauseCategoryId, CauseCategory> = {
  // 人との接触と車内の対応は事象が違う。立ち入りや不審物は選択肢に無く、知見なしになる
  passenger: {
    id: "passenger",
    eventType: null,
    kindChosenFirst: true,
    kinds: [
      { id: "person", eventType: "person_accident" },
      { id: "inCar", eventType: "in_car_response" },
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

// 画面の最初の選択肢。利用者がよく聞く順に、人身事故、車内の急病人を先頭に置く
export const causeChoiceIds = [
  "person",
  "inCar",
  "vehicle",
  "signaling",
  "power",
  "obstruction",
  "infrastructure",
  "weather",
  "major_accident",
] as const;
export type CauseChoiceId = (typeof causeChoiceIds)[number];

export function toCauseAnswer(choice: CauseChoiceId): CauseAnswer {
  return choice === "person" || choice === "inCar"
    ? { category: "passenger", kind: choice }
    : { category: choice, kind: null };
}

// 答えを、画面で選んだ選択肢の id に戻す。分からないは null
export function toCauseChoiceId(answer: CauseAnswer): CauseChoiceId | null {
  if (!answer.category) return null;
  if (answer.category !== "passenger") return answer.category;
  return answer.kind === "person" || answer.kind === "inCar" ? answer.kind : null;
}

export function needsCauseKind(category: CauseCategoryId): boolean {
  const { kinds, kindChosenFirst } = causeCategories[category];
  return kinds !== undefined && !kindChosenFirst;
}

export function listCauseKinds(category: CauseCategoryId): AskedKindId[] {
  return needsCauseKind(category)
    ? (causeCategories[category].kinds ?? []).map((k) => k.id).filter(isAskedKind)
    : [];
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

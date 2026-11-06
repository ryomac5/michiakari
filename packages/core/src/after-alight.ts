import type { RouteLeg, RouteOption } from "@repo/schema";
import { parseIsoToMs } from "./time.ts";

// 駅間の車内の人が、次の駅に着いた後に取れる一手を選ぶ
// 代替手段は、次の駅に着く見込みの時刻を起点に探したものを受け取る。ここでは比べて選ぶだけで、時刻は作らない

export type AfterAlightInput = {
  // ホームに着けて降りられる駅
  alightStation: string;
  // 代替手段を探した起点の駅。降りる駅と違えば、その手段は降りた駅から乗れない
  departureStation: string | null;
  // 行き先の駅。座標なら null
  destinationStation: string | null;
  // 乗ったまま待つ選択肢と、代替手段
  waitOption: RouteOption | null;
  options: readonly RouteOption[];
};

// 乗ったまま待つ経路の見立て
// stays_on: 乗ったままで行き先に着ける。needs_transfer: 乗り換えか徒歩が要る。route_unknown: 経路を引けていない
export type StayOn = "stays_on" | "needs_transfer" | "route_unknown";

// 次の一手を出さなかった理由と、出したとき
export type AfterAlightReason =
  | "destination_is_alight"
  | "different_departure"
  | "route_unknown"
  | "stays_on"
  | "no_candidate"
  | "wait_faster"
  | "found";

export type AfterAlightDecision = { step: RouteOption | null; reason: AfterAlightReason };

const normalizeName = (name: string) => name.trim().replace(/駅$/, "");

// 止まっている路線。待つ選択肢の待つ区間の路線、無ければ最初の乗車の路線
function findStoppedLineId(waitOption: Pick<RouteOption, "legs">): string | undefined {
  const legs = waitOption.legs;
  return legs.find((l) => l.mode === "wait")?.lineId ?? legs.find((l) => l.mode === "ride")?.lineId;
}

// 待つ経路を見立てる。乗車が無ければ経路を引けていないので、乗ったまま着けるとはみなさない
export function classifyStayOn(waitOption: Pick<RouteOption, "legs">): StayOn {
  const legs: readonly RouteLeg[] = waitOption.legs;
  if (legs.some((l) => l.mode === "walk" || l.mode === "taxi")) return "needs_transfer";
  const rides = legs.filter((l) => l.mode === "ride");
  if (rides.length === 0) return "route_unknown";
  const lineId = findStoppedLineId(waitOption);
  return lineId !== undefined && rides.every((l) => l.lineId === lineId)
    ? "stays_on"
    : "needs_transfer";
}

// 着いた後に乗れる手段。止まっている路線に乗る経路は、降りた後も同じ列車を待つことになるので外す
// 鉄道と徒歩のうち到着の早いものを選ぶ。タクシーは鉄道と徒歩の手段が無いときだけ選ぶ
function pickAfterAlightCandidate(
  options: readonly RouteOption[],
  stoppedLineId: string | undefined,
): RouteOption | null {
  const usable = options.filter(
    (o) =>
      o.kind !== "wait" &&
      !o.legs.some((l) => l.mode === "ride" && stoppedLineId && l.lineId === stoppedLineId),
  );
  const byArrival = (a: RouteOption, b: RouteOption) =>
    parseIsoToMs(a.arrivalTime) - parseIsoToMs(b.arrivalTime);
  const ground = usable.filter((o) => o.kind !== "taxi").sort(byArrival);
  return ground[0] ?? usable.filter((o) => o.kind === "taxi").sort(byArrival)[0] ?? null;
}

// 着いた後の次の一手と、その理由。行き先が降りる駅のとき、乗ったままで着けるとき、
// 待つ経路が分からないとき、乗ったままのほうが早いときは出さない
export function decideAfterAlightStep(input: AfterAlightInput): AfterAlightDecision {
  const { waitOption } = input;
  const alight = normalizeName(input.alightStation);
  if (input.destinationStation && normalizeName(input.destinationStation) === alight) {
    return { step: null, reason: "destination_is_alight" };
  }
  if (!input.departureStation || normalizeName(input.departureStation) !== alight) {
    return { step: null, reason: "different_departure" };
  }
  if (!waitOption) return { step: null, reason: "route_unknown" };
  const stayOn = classifyStayOn(waitOption);
  if (stayOn !== "needs_transfer") return { step: null, reason: stayOn };
  const candidate = pickAfterAlightCandidate(input.options, findStoppedLineId(waitOption));
  if (!candidate) return { step: null, reason: "no_candidate" };
  const faster = parseIsoToMs(candidate.arrivalTime) < parseIsoToMs(waitOption.arrivalTime);
  return faster ? { step: candidate, reason: "found" } : { step: null, reason: "wait_faster" };
}

// 着いた後の次の一手。出さないときは null
export function selectAfterAlightStep(input: AfterAlightInput): RouteOption | null {
  return decideAfterAlightStep(input).step;
}

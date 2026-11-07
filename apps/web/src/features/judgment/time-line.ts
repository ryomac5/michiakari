import type { Judgment, Place } from "@repo/schema";
import { selectInCarPlan } from "./in-car-plan";

// 閉じたシートに出す時刻の 1 行。「大阪に20時02分ごろ着く見込み」
// 時刻は判断の結果からそのまま取り、画面では計算しない

export type TimeLine = {
  // arrive は着く時刻、depart は自分の列車が動く時刻
  kind: "arrive" | "depart";
  // 着く駅。行き先が駅でなければ null
  station: string | null;
  time: string;
};

// 駅間の車内で次の駅で降りるときは、その駅に着く見込み。乗り続けるときは、自分の列車が動く見込み
// 乗り続ける人に次の駅の名前を最初に見せると、そこで降りるように読めるためである
// 駅にいる人は、勧める選択肢で行き先に着く見込み
export function selectTimeLine(judgment: Judgment, destination: Place): TimeLine | null {
  const inCar = judgment.inCar;
  if (inCar) {
    const plan = selectInCarPlan(inCar, destination);
    if (plan === "stay" && inCar.departure)
      return { kind: "depart", station: null, time: inCar.departure };
    return plan === "alight" && inCar.alightStation && inCar.alightArrival
      ? { kind: "arrive", station: inCar.alightStation, time: inCar.alightArrival }
      : null;
  }
  const option = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
  if (!option) return null;
  return {
    kind: "arrive",
    station: destination.kind === "station" ? destination.name : null,
    time: option.arrivalTime,
  };
}

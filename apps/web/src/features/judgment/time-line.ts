import type { Judgment, Place } from "@repo/schema";

// 閉じたシートに出す時刻の 1 行。「大阪に20時02分ごろ着く見込み」
// 時刻は判断の結果からそのまま取り、画面では計算しない

export type TimeLine = {
  // 着く駅。行き先が駅でなければ null
  station: string | null;
  time: string;
};

// 駅間の車内では、降りられる駅に着く見込み。駅にいる人は、勧める選択肢で行き先に着く見込み
export function selectTimeLine(judgment: Judgment, destination: Place): TimeLine | null {
  const inCar = judgment.inCar;
  if (inCar) {
    return inCar.alightStation && inCar.alightArrival
      ? { station: inCar.alightStation, time: inCar.alightArrival }
      : null;
  }
  const option = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
  if (!option) return null;
  return {
    station: destination.kind === "station" ? destination.name : null,
    time: option.arrivalTime,
  };
}

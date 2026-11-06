import { type ObservedStopScopeInput, resolveObservedStopScope, type StopScope } from "@repo/core";
import type { TrainPosition } from "@repo/schema";

// 止まり方を画面で引く。事象の選び方と止まり方の表は packages/core の 1 か所にあり、agent と同じ関数を呼ぶ
// 判断の推定が事象を決めていればそれを、無ければ知見のある観測の候補を確信度で選ぶ。どちらも無ければ入口の原因で決める
export function selectStopScope(input: ObservedStopScopeInput): StopScope {
  return resolveObservedStopScope(input);
}

// その列車だけが止まるときの、上部の帯の止まった場所。駅間なら「大阪〜塚本」、駅に止まった車内なら駅名
// 駅で待っている人には場所を出さず、後続の遅れとして伝える
export type StoppedPlace =
  | { kind: "between"; from: string; to: string }
  | { kind: "station"; name: string };

export function selectStoppedPlace(
  trainPosition: TrainPosition | null,
  originStation: string | null,
): StoppedPlace | null {
  if (trainPosition?.kind === "between_stations") {
    const { previousStation, nextStation } = trainPosition;
    return previousStation && nextStation
      ? { kind: "between", from: previousStation, to: nextStation }
      : null;
  }
  if (trainPosition?.kind === "on_train_at_station" && originStation) {
    return { kind: "station", name: originStation };
  }
  return null;
}

import { resolveStopScope, type StopScope } from "@repo/core";
import type { IncidentCause, Observation, TrainPosition } from "@repo/schema";

// 止まり方を画面で引く。区別の表は packages/core の 1 か所にあり、agent と同じものを使う
// 判断の推定が事象を決めていればそれを、無ければ新しい観測の第一候補を使う。どちらも無ければ入口の原因で決める
// その列車から止まる故障は、発表に区間が出たら区間の見合わせとする
export function selectStopScope(
  estimatedEventType: string | null | undefined,
  observations: readonly Observation[],
  cause: IncidentCause | null = null,
): StopScope {
  const latest = observations.findLast((o) => o.eventTypeCandidates.length > 0);
  return resolveStopScope({
    eventType: estimatedEventType || (latest?.eventTypeCandidates[0]?.eventType ?? null),
    cause,
    sectionAnnounced: observations.some((o) => o.section !== null),
  });
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

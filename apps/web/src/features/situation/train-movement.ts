import type { Observation, TrainPosition } from "@repo/schema";

// 読み取った並びを、ふだんの間隔を仮定しない車内の前提にする
export function applyTrainMovement(
  position: TrainPosition | null,
  observation: Observation,
): TrainPosition | null {
  if (position?.kind !== "between_stations" || observation.trainsAhead === undefined)
    return position;
  return {
    ...position,
    trainsAhead: observation.trainsAhead,
    trainsAheadCount: null,
    trainsAheadHeadwayMinutes: null,
  };
}

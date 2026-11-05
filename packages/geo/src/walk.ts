import { computeWalkMinutesFromMeters } from "@repo/core";
import type { TransferEdge } from "./types.ts";

// 乗換の徒歩分。Valhalla の経路があればそれを使い、無ければ直線距離から概算する
export function getTransferWalkMinutes(transfer: TransferEdge): number {
  return transfer.walkMinutes ?? computeWalkMinutesFromMeters(transfer.walkMeters);
}

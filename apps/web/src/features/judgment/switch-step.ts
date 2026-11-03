import type { Judgment, RouteOption } from "@repo/schema";

// 切り替えの判断で、閉じたシートに出す次の一手。数値は推奨の選択肢からそのまま取り、画面で作らない

export type SwitchStep = {
  optionId: string;
  kind: RouteOption["kind"];
  // 最初に乗る路線と駅。タクシーと徒歩では null
  line: string | null;
  station: string | null;
  // 最初に乗る駅までの徒歩。乗る前の徒歩の区間を足したもの
  walkMinutes: number;
  arrivalTime: string;
};

export function selectSwitchStep(judgment: Judgment | null): SwitchStep | null {
  if (judgment?.action !== "switch") return null;
  const option = judgment.options.find((o) => o.id === judgment.recommendedOptionId);
  if (!option || option.kind === "wait") return null;
  const base = { optionId: option.id, kind: option.kind, arrivalTime: option.arrivalTime };

  const rideIndex = option.legs.findIndex((leg) => leg.mode === "ride");
  const ride = option.legs[rideIndex];
  if (option.kind !== "transfer" || !ride) {
    return { ...base, line: null, station: null, walkMinutes: option.walkMinutes };
  }
  const walkMinutes = option.legs
    .slice(0, rideIndex)
    .filter((leg) => leg.mode === "walk")
    .reduce((sum, leg) => sum + leg.minutes, 0);
  return { ...base, line: ride.line ?? null, station: ride.from, walkMinutes };
}

import type { RouteOption } from "@repo/schema";
import { findLineOperatorKey, normalizeOperatorKey } from "./train-queue.ts";

// 防護無線の事象での乗り換え先の並べ方
// 防護無線で止まるのは同じ会社の列車だけ。並ぶ他社の線はすぐ使えるので上げ、同じ会社の線は最初は一緒に止まるので下げる

export type RankableAlternative = Pick<RouteOption, "id" | "kind" | "legs">;

// raised は上げた、lowered は下げた、neutral はそのまま
export const ALTERNATIVE_STANDINGS = ["raised", "neutral", "lowered"] as const;
export type AlternativeStanding = (typeof ALTERNATIVE_STANDINGS)[number];

export type RankedAlternative<T extends RankableAlternative> = {
  option: T;
  standing: AlternativeStanding;
};

export type ProtectionRankingInput<T extends RankableAlternative> = {
  options: readonly T[];
  // checkProtectionIncident の結果
  protection: boolean;
  // 止まっている路線 ID。例: jr-west.東海道線
  blockedLineId: string | null;
  // 路線 ID が無いときの事業者名か事業者キー
  blockedOperator?: string | null;
};

const STANDING_ORDER: Readonly<Record<AlternativeStanding, number>> = {
  raised: 0,
  neutral: 1,
  lowered: 2,
};

function listRideOperators(option: RankableAlternative): string[] {
  return option.legs.flatMap((leg) => {
    if (leg.mode !== "ride") return [];
    const key = findLineOperatorKey(leg.lineId ?? null);
    return key ? [key] : [];
  });
}

function classifyStanding(
  option: RankableAlternative,
  blockedOperator: string,
): AlternativeStanding {
  if (option.kind === "wait") return "neutral";
  const operators = listRideOperators(option);
  if (operators.length === 0) return "neutral";
  return operators.includes(blockedOperator) ? "lowered" : "raised";
}

// 防護無線の事象でなければ、または止まった会社が分からなければ、並びを変えずに neutral で返す
// 同じ段の中は元の並びを保つ
export function rankAlternativesForProtection<T extends RankableAlternative>(
  input: ProtectionRankingInput<T>,
): RankedAlternative<T>[] {
  const blockedOperator =
    findLineOperatorKey(input.blockedLineId) ??
    normalizeOperatorKey(input.blockedOperator ?? null) ??
    input.blockedOperator ??
    null;
  const ranked = input.options.map((option) => ({
    option,
    standing:
      input.protection && blockedOperator
        ? classifyStanding(option, blockedOperator)
        : ("neutral" as const),
  }));
  return ranked.sort((a, b) => STANDING_ORDER[a.standing] - STANDING_ORDER[b.standing]);
}

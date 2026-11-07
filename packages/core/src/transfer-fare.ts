import type { RouteOption, TicketType, TransferFare } from "@repo/schema";
import {
  KANSAI_COMMON_TRANSFER_OPERATORS,
  TICKET_TRANSFER_ELIGIBLE,
} from "../params/transfer-fare.ts";
import { findLineOperatorKey, normalizeOperatorKey } from "./train-queue.ts";

// 乗り換え先の追加の費用を、利用者の乗車券の種類で決める
// 振替輸送の対象なら他社の線への乗り換えに追加の運賃はかからない。対象外なら運賃がかかる

export type TransferFareInput = {
  // 分からなければ null
  ticketType: TicketType | null;
  // 発表の振替輸送の実施。行わないと書かれていれば false。書かれていなければ null
  transferServiceActive: boolean | null;
  // 止まっている線の事業者キー。分からなければ null
  blockedOperator: string | null;
  // 乗り換え先で乗る線の事業者キー。路線 ID から引けなかった線は null
  rideOperators: readonly (string | null)[];
};

function isCommonOperator(operator: string): boolean {
  return KANSAI_COMMON_TRANSFER_OPERATORS.includes(operator);
}

// 費用を決められなければ null。乗車券が分からない、他社の線に乗らない、扱いを確かめていない事業者を含む、のとき
export function decideTransferFare(input: TransferFareInput): TransferFare | null {
  if (input.ticketType === null || input.blockedOperator === null) return null;
  if (!isCommonOperator(input.blockedOperator)) return null;
  if (input.rideOperators.includes(null)) return null;
  const others = input.rideOperators.filter((o): o is string => o !== input.blockedOperator);
  if (others.length === 0 || !others.every(isCommonOperator)) return null;
  if (input.transferServiceActive === false) return "fare_required";
  return TICKET_TRANSFER_ELIGIBLE[input.ticketType] ? "covered" : "fare_required";
}

// 路線 ID「hankyu.神戸線」の先頭を事業者キーにそろえる。ID の形でなければ null
export function resolveLineOperator(lineId: string | null | undefined): string | null {
  if (!lineId?.includes(".")) return null;
  const key = findLineOperatorKey(lineId);
  return key ? (normalizeOperatorKey(key) ?? key) : null;
}

type FareOption = Pick<RouteOption, "kind" | "legs"> & Partial<Pick<RouteOption, "transferFare">>;

export type ApplyTransferFaresInput<T extends FareOption> = {
  options: readonly T[];
  ticketType: TicketType | null;
  transferServiceActive: boolean | null;
  // 止まっている線の路線 ID。無ければ事業者名から決める
  blockedLineId: string | null;
  blockedOperatorName?: string | null;
};

// 鉄道で乗り換える選択肢にだけ費用の印を付ける。決められない選択肢からは印を外す
export function applyTransferFares<T extends FareOption>(input: ApplyTransferFaresInput<T>): T[] {
  const blockedOperator =
    resolveLineOperator(input.blockedLineId) ??
    normalizeOperatorKey(input.blockedOperatorName ?? null);
  return input.options.map((option) => {
    const { transferFare: _drop, ...rest } = option;
    if (option.kind !== "transfer") return rest as T;
    const fare = decideTransferFare({
      ticketType: input.ticketType,
      transferServiceActive: input.transferServiceActive,
      blockedOperator,
      rideOperators: option.legs
        .filter((leg) => leg.mode === "ride")
        .map((leg) => resolveLineOperator(leg.lineId)),
    });
    return (fare === null ? rest : { ...rest, transferFare: fare }) as T;
  });
}

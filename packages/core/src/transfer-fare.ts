import type { RouteOption, TicketType, TransferFare } from "@repo/schema";
import { OPERATOR_KEY_ALIASES } from "../params/train-queue.ts";
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
  // 発表に振替先として書かれた事業者キー。書かれていなければ空
  transferOperators: readonly string[];
  // 止まっている線の事業者キー。分からなければ null
  blockedOperator: string | null;
  // 乗り換え先で乗る線の事業者キー。路線 ID から引けなかった線は null
  rideOperators: readonly (string | null)[];
};

function isCommonOperator(operator: string): boolean {
  return KANSAI_COMMON_TRANSFER_OPERATORS.includes(operator);
}

// 他社の線の事業者キー。費用を決められない経路なら null
function listOtherOperators(input: TransferFareInput): string[] | null {
  if (input.blockedOperator === null || !isCommonOperator(input.blockedOperator)) return null;
  if (input.rideOperators.includes(null)) return null;
  const others = input.rideOperators.filter((o): o is string => o !== input.blockedOperator);
  return others.length > 0 && others.every(isCommonOperator) ? others : null;
}

// 費用を決められなければ null。乗車券も振替輸送の実施も分からない、他社の線に乗らない、扱いを確かめていない事業者を含む、のとき
// 発表に振替なしとあれば、乗車券によらず運賃がかかる
// IC カードは振替輸送の対象外なので、実施が分からなくても運賃がかかる
// 定期券と紙の切符は、実施が分かったときだけ示す。発表の振替先に含まれれば対象、振替先が書かれていなければ対象になりうる
export function decideTransferFare(input: TransferFareInput): TransferFare | null {
  const others = listOtherOperators(input);
  if (others === null) return null;
  if (input.transferServiceActive === false) return "fare_required";
  if (input.ticketType === null) return null;
  if (!TICKET_TRANSFER_ELIGIBLE[input.ticketType]) return "fare_required";
  if (input.transferServiceActive === null) return null;
  const announced = input.transferOperators.filter((o) => o !== input.blockedOperator);
  if (announced.length === 0) return "possibly_covered";
  return others.every((o) => announced.includes(o)) ? "covered" : null;
}

// 文に書かれた事業者名を事業者キーにする。「JR」だけの書き方は JR西日本とみなす
export function findOperatorKeysInText(text: string): string[] {
  const normalized = text.normalize("NFKC");
  const keys = Object.entries(OPERATOR_KEY_ALIASES)
    .filter(([, aliases]) => aliases.some((a) => normalized.includes(a.normalize("NFKC"))))
    .map(([key]) => key);
  if (/JR/.test(normalized) && !keys.includes("jr-west")) keys.push("jr-west");
  return keys;
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
  // 発表に振替先として書かれた事業者名。書かれていなければ空
  transferOperators?: readonly string[];
  // 止まっている線の路線 ID。無ければ事業者名から決める
  blockedLineId: string | null;
  blockedOperatorName?: string | null;
};

// 鉄道で乗り換える選択肢にだけ費用の印を付ける。決められない選択肢からは印を外す
export function applyTransferFares<T extends FareOption>(input: ApplyTransferFaresInput<T>): T[] {
  const blockedOperator =
    resolveLineOperator(input.blockedLineId) ??
    normalizeOperatorKey(input.blockedOperatorName ?? null);
  const transferOperators = (input.transferOperators ?? []).flatMap((name) => {
    const key = normalizeOperatorKey(name) ?? findOperatorKeysInText(name)[0];
    return key ? [key] : [];
  });
  return input.options.map((option) => {
    const { transferFare: _drop, ...rest } = option;
    if (option.kind !== "transfer") return rest as T;
    const fare = decideTransferFare({
      ticketType: input.ticketType,
      transferServiceActive: input.transferServiceActive,
      transferOperators,
      blockedOperator,
      rideOperators: option.legs
        .filter((leg) => leg.mode === "ride")
        .map((leg) => resolveLineOperator(leg.lineId)),
    });
    return (fare === null ? rest : { ...rest, transferFare: fare }) as T;
  });
}

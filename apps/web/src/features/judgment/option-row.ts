import type { RouteLeg, RouteOption, TransferFare } from "@repo/schema";

// 選択肢の行に出す値。分からない値と 0 分の徒歩は出さず、経路は乗る路線の名前だけを並べる

// 乗る路線の名前を乗る順に並べる。続けて同じ路線に乗るときは 1 つにする
// translate は英語の画面で路線名を訳す。訳せなければ null を返し、その路線は出さない
export function listRideLines(
  legs: readonly RouteLeg[],
  translate: (line: string) => string | null,
): string[] {
  return legs
    .flatMap((leg) => {
      if (leg.mode !== "ride" || !leg.line) return [];
      const name = translate(leg.line);
      return name ? [name] : [];
    })
    .filter((name, index, names) => names[index - 1] !== name);
}

// 行の右下に出す徒歩と運賃。徒歩が 0 分なら徒歩を、運賃が分からなければ運賃を出さない
// 乗り換え先の追加の費用は、乗車券の種類から決まったときだけ出す
export function selectOptionFacts(
  option: Pick<RouteOption, "walkMinutes" | "fareYen"> & Partial<Pick<RouteOption, "transferFare">>,
): {
  walkMinutes: number | null;
  fareYen: number | null;
  transferFare: TransferFare | null;
} {
  return {
    walkMinutes: option.walkMinutes > 0 ? option.walkMinutes : null,
    fareYen: option.fareYen,
    transferFare: option.transferFare ?? null,
  };
}

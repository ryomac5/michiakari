import type { Judgment, Place } from "@repo/schema";
import type { AlternativesProvider } from "../alternatives/provider.ts";

// 確定した判断に、出発地の近くのバス停の確認候補を付ける
// 判断の後に決定論で付けるので、Claude には渡らず、見出し・理由・推奨にも入らない
export function attachBusChecks(
  judgment: Judgment,
  provider: AlternativesProvider,
  origin: Place,
): Judgment {
  const busChecks = provider.listBusChecks(origin);
  return busChecks.length > 0 ? { ...judgment, busChecks } : judgment;
}

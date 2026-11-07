import type { InCarGuide, Place } from "@repo/schema";

// 駅の間の車内の人に勧める動き。判断の結果に「次の駅で降りる」の欄は無いので、案内と行き先から決める
// alight は次の駅で降りる。stay は行き先まで乗り続ける。unknown は動く見込みか次の駅が分からない

export type InCarPlan = "alight" | "stay" | "unknown";

export function selectInCarPlan(guide: InCarGuide, destination: Place): InCarPlan {
  if (!guide.alightStation) return "unknown";
  // 着いた後の一手があれば、次の駅で降りて別の手段に移る
  if (guide.afterAlight) return "alight";
  // 次の駅が行き先なら、そこで降りる
  if (destination.kind === "station" && destination.name === guide.alightStation) return "alight";
  // 動く見込みが無ければ、乗り続けるとも言えない。線路に降りる案内のときもこれに当たる
  if (!guide.departure) return "unknown";
  return "stay";
}

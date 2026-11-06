// 代替経路の探索で使う調整値
// 出典: 開発者の推定（仮）

export const ROUTING_PARAMS_SOURCE = "開発者の推定（仮）";

// 返す鉄道経路の最大本数。出典: 開発者の推定（仮）
export const MAX_ROUTE_CANDIDATES = 3;

// 最短の候補に対する所要時間の比の上限。これを超える遠回りは返さない。出典: 開発者の推定（仮）
export const MAX_ROUTE_RATIO_TO_BEST = 2;

// 全区間徒歩を候補に入れる上限（分）。出典: 開発者の推定（仮）
export const WALK_ONLY_MAX_MINUTES = 20;

// 徒歩を減らしたい利用者の場合の上限（分）。出典: 開発者の推定（仮）
export const WALK_ONLY_MAX_MINUTES_REDUCED = 10;

// 徒歩を減らしたい利用者の場合に、探索で徒歩の分に掛ける重み。出典: 開発者の推定（仮）
export const REDUCED_WALK_COST_FACTOR = 2;

// 乗換を減らしたい利用者の場合に、2本目以降の乗車ごとに探索で足す分。出典: 開発者の推定（仮）
export const REDUCED_TRANSFER_PENALTY_MINUTES = 10;

// 再開を待つ経路の探索で、止まっている路線以外に乗るたびに足す分。出典: 開発者の推定（仮）
export const OTHER_LINE_PENALTY_MINUTES = 15;

// 現在地の駅から歩いて別の鉄道の駅へ乗りに行くときの、徒歩の上限（分）。
// 地図の吹き出しに出す駅と代替手段の探索の候補は、この値で同じ駅を選ぶ。出典: 開発者が確かめた値
export const ACCESS_WALK_MAX_MINUTES = 15;

// 通常の上限の中に鉄道の代替が 1 つも無いときに、乗る駅までの徒歩の上限を広げる先（分）。
// 地図が歩ける駅として出す範囲に合わせる。10 分と 20 分の到達範囲の輪の外にある駅も含む。出典: 開発者が確かめた値
export const ACCESS_WALK_MAX_MINUTES_EXTENDED = 25;

// バス停を確認候補に出すときの、停留所までの徒歩の上限（分）。出典: 開発者の推定（仮）
export const BUS_CHECK_MAX_WALK_MINUTES = 10;

// 同じ名前のバス停を 1 件にまとめる距離（m）。道の両側や会社ごとの標柱を 1 行で見せる。出典: 開発者の推定（仮）
export const BUS_STOP_SAME_NAME_METERS = 300;

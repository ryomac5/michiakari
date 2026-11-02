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

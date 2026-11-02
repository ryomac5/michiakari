// 残り時間推定のモンテカルロ設定

// 標本数。多いほど結果が安定し、遅くなる
export const MONTE_CARLO_SAMPLE_COUNT = 20_000;

// 擬似乱数の固定シード。同じ入力なら常に同じ出力にする
export const MONTE_CARLO_SEED = 0x5eed_2026;

// p50 が 0 で p80 が正のとき、対数正規分布を当てはめるために使う中央値（分）
// 出典: 開発者の推定（仮）
export const MIN_MEDIAN_MINUTES = 0.5;

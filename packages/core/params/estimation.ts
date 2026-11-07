// 残り時間推定のモンテカルロ設定

// 標本数。多いほど結果が安定し、遅くなる
export const MONTE_CARLO_SAMPLE_COUNT = 20_000;

// 擬似乱数の固定シード。同じ入力なら常に同じ出力にする
export const MONTE_CARLO_SEED = 0x5eed_2026;

// p50 が 0 で p80 が正のとき、対数正規分布を当てはめるために使う中央値（分）
// 出典: 開発者の推定（仮）
export const MIN_MEDIAN_MINUTES = 0.5;

// 原因が分からず、放送で聞いた再開見込みの時刻だけがあるときの延びる余地（分）
// p50 は発表の時刻どおりとし、p80 はこの分だけ後ろに置く
// 放送の見込みは 10 分刻みの切りのよい時刻で言われることが多く、原因が分からないと延びる余地を知見から見積もれないので、その 1 刻み分を余地とする
// 出典: 開発者が確かめた値
export const STATED_RESUME_SLACK_MINUTES = 10;

// 統計値の時間帯の境。平日にこの時台で止まったら通勤時間帯の値を使う。各組は [始まりの時, 終わりの時) で、終わりの時台は含まない
// 統計値のファイルは境を定数で持たないので、生成元の COMMUTE_HOURS と同じ値をここに置き、単体テストで一致を確かめる
// 出典: docs/research/rail-suspensions/build_incident_durations.py の COMMUTE_HOURS。開発者が確かめた値
export const COMMUTE_HOUR_RANGES: readonly (readonly [number, number])[] = [
  [7, 10],
  [17, 20],
];

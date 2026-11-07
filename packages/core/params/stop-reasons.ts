// 電車の中で止まった利用者の列車が、なぜ止まったかを見積もる目安
// 出典: 開発者の推定（仮）。外から観察できる振る舞いの目安で、社内規程の数値や手順ではない

import type { IncidentTypeId } from "./incident-durations.ts";

export const STOP_REASONS_SOURCE = "開発者の推定";

// 防護無線を受けて止まる範囲。発生場所の周りの片側の距離（km）
export const PROTECTION_RADIUS_KM = 1;

// 指令が区間ごと止めるときの、止める区間の長さ（km）
export const DISPATCH_SECTION_KM = 10;

// 「前の列車がつかえて」が聞こえたとき、詰まりの本数に掛ける重み
export const QUEUE_AHEAD_CUE_WEIGHT = 5;

// 当該列車の無い事象。天気の大分類のほかに足す種類。停電は区間の列車が一斉に止まる
export const NO_OWN_TRAIN_EXTRA_TYPES: readonly IncidentTypeId[] = ["power_outage"];

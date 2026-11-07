// 電車の中で止まった利用者の列車が、なぜ止まったかを見積もる目安
// 出典: 開発者の推定（仮）。外から観察できる振る舞いの目安で、社内規程の数値や手順ではない

import type { StopReason } from "@repo/schema";
import type { IncidentTypeId } from "./incident-durations.ts";

export const STOP_REASONS_SOURCE = "開発者の推定";

// 防護無線を受けて止まる範囲。発生場所の周りの片側の距離（km）
export const PROTECTION_RADIUS_KM = 1;

// 指令が信号と無線で周りの列車を止める範囲。発生場所の前後それぞれの距離（km）
// 防護無線の事象でも、受信の範囲の外の列車は指令の指示で止まる
export const DISPATCH_RADIUS_KM = 10;

// 「前の列車がつかえて」が聞こえたとき、詰まりの本数に掛ける重み
export const QUEUE_AHEAD_CUE_WEIGHT = 5;

// 割合が同じとき、いちばん高い理由に選ぶ順
export const STOP_REASON_TIE_ORDER = [
  "protection_received",
  "dispatcher_order",
  "queued_behind",
  "own_incident",
] as const satisfies readonly StopReason[];

// 当該列車の無い事象。天気の大分類のほかに足す種類。停電は区間の列車が一斉に止まる
export const NO_OWN_TRAIN_EXTRA_TYPES: readonly IncidentTypeId[] = ["power_outage"];

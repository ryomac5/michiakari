// 駅間に止まった列車が次の駅に着くまでの見込みに使う値
// 出典: 開発者の経験からの目安。社内規程の数値ではない

import type { DurationDist, TrainsAheadCount, TrainType } from "@repo/schema";

export const TRAIN_QUEUE_PARAMS_SOURCE = "開発者の経験からの目安";

// 事業者ごとの詰める動き
export type TrainQueueParams = {
  // 止まっている間に、駅間の列車を前の駅へ順に進めるか
  // 詰め始めるのは線路の安全が確かめられてから。外からは再開に向けた放送か、再開の見込みの時刻が出たことで分かる
  closesUp: boolean;
  // 前の列車 1 本が 1 つの信号の区間を空けるまでの分。信号機と信号機の間には列車が 1 本しか入れない
  // 経験からの目安で 3〜5 分。中央を 4 分、長めを 5 分とする
  minutesPerTrainAhead: DurationDist;
};

// 既定は詰めない。詰める事業者だけを下の表で上書きする
export const DEFAULT_TRAIN_QUEUE_PARAMS: TrainQueueParams = {
  closesUp: false,
  minutesPerTrainAhead: { p50: 4, p80: 5 },
};

// 前の列車 1 本が信号の区間を空けるまでの短いほうの目安（分）。3〜5 分の幅の下端
// 出典: 開発者の推定
export const MIN_MINUTES_PER_TRAIN_AHEAD = 3;

// キーは路線 ID の先頭と同じ事業者キー
// 詰める動きは、まず JR西日本だけを対象にする
export const TRAIN_QUEUE_PARAMS_BY_OPERATOR: Readonly<Record<string, Partial<TrainQueueParams>>> = {
  "jr-west": { closesUp: true },
};

// 観測の事業者名の表記の揺れ。空白、ハイフン、大文字小文字を除いてから比べる
export const OPERATOR_KEY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "jr-west": ["jr-west", "JR西日本", "JR西", "JR West", "西日本旅客鉄道"],
};

// 次の駅までの走行時間を路線データから引けないときの代わりの分。関西の都市部の駅間を控えめに丸めた値
// 出典: 開発者の推定（仮）
export const FALLBACK_RIDE_MINUTES_TO_NEXT_STATION = 3;

// 本数の目安を本数にする。1〜2 本は 2 本、3 本以上は 3 本、分からなければ 1 本として控えめに置く
// 出典: 開発者の推定（仮）
export const TRAINS_AHEAD_COUNT: Readonly<Record<TrainsAheadCount, number>> = {
  none: 0,
  few: 2,
  many: 3,
  unknown: 1,
};

// 路線と方面のくり返しの運転パターン。前の列車の既定値を推し量るのに使う
// 個々の列車の時刻は写さない。1 周期の分数と、その周期の中の種別の並びだけを持つ
export type OperationPattern = {
  cycleMinutes: number;
  // 1 周期の中で先に来る順の種別
  sequence: readonly Exclude<TrainType, "unknown">[];
  // 複々線で、快速系と普通が別の線路を走る区間。同じ線路の列車だけを前の列車に数える
  separateTracks: boolean;
};

export type LineOperationPattern = {
  lineId: string;
  // この方面の先にある駅。先の駅の並びにどれかが含まれる方面に当てる
  towardStations: readonly string[];
  daytime: OperationPattern;
};

// 複々線の JR神戸線・JR京都線の大阪付近。日中は 15 分ごとに新快速 1、快速 1、普通 2 が来るとみなす
// 大阪へ向かう方面を先に置く。塚本や新大阪から大阪へ向かう並びは、直通先の駅も含むため
// 出典: 開発者の観察にもとづく運転パターンの要約。時刻表は写していない。仮の値
const jrTokaidoDaytime: OperationPattern = {
  cycleMinutes: 15,
  sequence: ["special_rapid", "local", "rapid", "local"],
  separateTracks: true,
};

export const OPERATION_PATTERNS: readonly LineOperationPattern[] = [
  { lineId: "jr-west.東海道線", towardStations: ["大阪"], daytime: jrTokaidoDaytime },
  {
    lineId: "jr-west.東海道線",
    towardStations: ["三ノ宮", "元町", "神戸", "西明石"],
    daytime: jrTokaidoDaytime,
  },
  {
    lineId: "jr-west.東海道線",
    towardStations: ["新大阪", "高槻", "京都"],
    daytime: jrTokaidoDaytime,
  },
];

// 駅ごとの「着けるホーム」。その向きに止まれる種別と、同じ向きに同時に止められる本数
export type StationPlatform = {
  // この駅のホームに着ける種別。unknown は普通として扱うので表には書かない
  accepts: readonly Exclude<TrainType, "unknown">[];
  // その向きのホームの数。詰めるとき、この本数まで列車を入れられる
  platformsPerDirection: number;
};

export const ALL_TRAIN_TYPES: readonly Exclude<TrainType, "unknown">[] = [
  "local",
  "rapid",
  "special_rapid",
  "limited_express",
];

// 表に無い駅の既定。どの種別も着け、ホームは 1 本とみなす
export const DEFAULT_STATION_PLATFORM: StationPlatform = {
  accepts: ALL_TRAIN_TYPES,
  platformsPerDirection: 1,
};

const localOnly: StationPlatform = { accepts: ["local"], platformsPerDirection: 1 };
const upToRapid: StationPlatform = { accepts: ["local", "rapid"], platformsPerDirection: 1 };
const all1: StationPlatform = { accepts: ALL_TRAIN_TYPES, platformsPerDirection: 1 };
const all2: StationPlatform = { accepts: ALL_TRAIN_TYPES, platformsPerDirection: 2 };

// デモで使う区間だけを入れる。JR神戸線の大阪〜三ノ宮と、JR京都線の大阪〜京都
// 駅名は国土数値情報の駅名で引く。路線は jr-west.東海道線
// 出典: 公開の時刻表の停車駅をもとにした仮の値。ホームの長さと数は開発者が確認する
export const STATION_PLATFORMS_BY_LINE: Readonly<
  Record<string, Readonly<Record<string, StationPlatform>>>
> = {
  "jr-west.東海道線": {
    // JR神戸線 大阪〜三ノ宮
    大阪: all2,
    塚本: localOnly,
    尼崎: all2,
    立花: localOnly,
    甲子園口: localOnly,
    西宮: upToRapid,
    さくら夙川: localOnly,
    芦屋: all1,
    甲南山手: localOnly,
    摂津本山: localOnly,
    住吉: upToRapid,
    六甲道: upToRapid,
    灘: localOnly,
    三ノ宮: all2,
    // JR京都線 大阪〜京都
    新大阪: all2,
    東淀川: localOnly,
    吹田: localOnly,
    岸辺: localOnly,
    千里丘: localOnly,
    茨木: upToRapid,
    摂津富田: localOnly,
    JR総持寺: localOnly,
    高槻: all2,
    島本: upToRapid,
    山崎: upToRapid,
    長岡京: upToRapid,
    向日町: upToRapid,
    桂川: upToRapid,
    西大路: upToRapid,
    京都: all2,
  },
};

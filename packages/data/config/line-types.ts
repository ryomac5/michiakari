import type { LineType } from "@repo/geo";

// 路線種別の割り当て表。乗車時間の概算で表定速度を選ぶのに使う
// 方針: JR は快速・新快速が走る路線を jr_rapid、それ以外を jr_local
// 私鉄は急行・特急が走る幹線を private_express、それ以外を private_local
// 新交通（AGT）はモノレールと速度帯が近いので monorail に含める

// 事業者ごとの既定値。表にない事業者は private_local
export const OPERATOR_DEFAULT_LINE_TYPES: Readonly<Record<string, LineType>> = {
  "jr-west": "jr_local",
  "osaka-metro": "subway",
  "kyoto-subway": "subway",
  "kobe-subway": "subway",
  kitakyu: "subway",
  "osaka-monorail": "monorail",
  "kobe-new-transit": "monorail",
  hankai: "tram",
  keifuku: "tram",
};

export const DEFAULT_LINE_TYPE: LineType = "private_local";

// 路線ごとの上書き。キーは正規化後の「事業者キー:路線名」
export const LINE_TYPE_OVERRIDES: Readonly<Record<string, LineType>> = {
  "jr-west:東海道線": "jr_rapid",
  "jr-west:山陽線": "jr_rapid",
  "jr-west:阪和線": "jr_rapid",
  "jr-west:関西線": "jr_rapid",
  "jr-west:福知山線": "jr_rapid",
  "jr-west:湖西線": "jr_rapid",
  "jr-west:奈良線": "jr_rapid",
  "jr-west:片町線": "jr_rapid",
  "jr-west:JR東西線": "jr_rapid",
  "jr-west:関西空港線": "jr_rapid",
  "jr-west:山陰線": "jr_rapid",
  "jr-west:おおさか東線": "jr_rapid",
  "hankyu:京都線": "private_express",
  "hankyu:神戸線": "private_express",
  "hankyu:宝塚線": "private_express",
  "hanshin:本線": "private_express",
  "hanshin:阪神なんば線": "private_express",
  "keihan:京阪本線": "private_express",
  "keihan:鴨東線": "private_express",
  "keihan:中之島線": "private_express",
  "keihan:石山坂本線": "tram",
  "nankai:南海本線": "private_express",
  "nankai:高野線": "private_express",
  "nankai:空港線": "private_express",
  "kintetsu:難波線": "private_express",
  "kintetsu:奈良線": "private_express",
  "kintetsu:大阪線": "private_express",
  "kintetsu:京都線": "private_express",
  "kintetsu:橿原線": "private_express",
  "kintetsu:南大阪線": "private_express",
  "kintetsu:吉野線": "private_express",
  "kintetsu:けいはんな線": "subway",
  "osaka-metro:南港ポートタウン線": "monorail",
  "sanyo:本線": "private_express",
};

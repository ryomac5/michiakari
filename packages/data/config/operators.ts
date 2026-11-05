// 事業者名の正規化表。国土数値情報の事業者名（N02_004）を短い表示名と ASCII のキーに対応づける

export type OperatorRule = {
  raw: string;
  key: string;
  name: string;
};

export const OPERATORS: readonly OperatorRule[] = [
  { raw: "西日本旅客鉄道", key: "jr-west", name: "JR西日本" },
  { raw: "阪急電鉄", key: "hankyu", name: "阪急" },
  { raw: "阪神電気鉄道", key: "hanshin", name: "阪神" },
  { raw: "大阪市高速電気軌道", key: "osaka-metro", name: "Osaka Metro" },
  { raw: "南海電気鉄道", key: "nankai", name: "南海" },
  // 2025年4月に南海へ合併。古い版のデータでも南海として扱う
  { raw: "泉北高速鉄道", key: "nankai", name: "南海" },
  { raw: "京阪電気鉄道", key: "keihan", name: "京阪" },
  { raw: "近畿日本鉄道", key: "kintetsu", name: "近鉄" },
  { raw: "北大阪急行電鉄", key: "kitakyu", name: "北大阪急行" },
  { raw: "大阪モノレール", key: "osaka-monorail", name: "大阪モノレール" },
  { raw: "大阪高速鉄道", key: "osaka-monorail", name: "大阪モノレール" },
  { raw: "山陽電気鉄道", key: "sanyo", name: "山陽電車" },
  { raw: "神戸市", key: "kobe-subway", name: "神戸市営地下鉄" },
  // 2020年に神戸市へ移管
  { raw: "北神急行電鉄", key: "kobe-subway", name: "神戸市営地下鉄" },
  { raw: "京都市", key: "kyoto-subway", name: "京都市営地下鉄" },
  { raw: "神戸電鉄", key: "shintetsu", name: "神戸電鉄" },
  { raw: "神戸新交通", key: "kobe-new-transit", name: "神戸新交通" },
  { raw: "阪堺電気軌道", key: "hankai", name: "阪堺電車" },
  { raw: "京福電気鉄道", key: "keifuku", name: "京福電気鉄道" },
  { raw: "叡山電鉄", key: "eiden", name: "叡山電車" },
  { raw: "能勢電鉄", key: "nose", name: "能勢電鉄" },
  { raw: "水間鉄道", key: "mizuma", name: "水間鉄道" },
  { raw: "和歌山電鐵", key: "wakayama-dentetsu", name: "和歌山電鐵" },
  { raw: "信楽高原鐵道", key: "shigaraki", name: "信楽高原鐵道" },
  { raw: "北条鉄道", key: "hojo", name: "北条鉄道" },
  { raw: "近江鉄道", key: "ohmi", name: "近江鉄道" },
  { raw: "伊賀鉄道", key: "iga", name: "伊賀鉄道" },
];

// 路線名の付け替え。キーは「元の事業者名:元の路線名」
export const LINE_RENAMES: Readonly<Record<string, string>> = {
  "泉北高速鉄道:泉北高速鉄道線": "泉北線",
  "北神急行電鉄:北神線": "北神線",
};

// 抽出しない事業者。観光用で日常の移動手段にならない
export const EXCLUDED_OPERATORS: readonly string[] = ["嵯峨野観光鉄道"];

// 鉄道区分（N02_001）の除外。13 は鋼索鉄道（ケーブルカー）
export const EXCLUDED_RAILWAY_CLASSES: readonly string[] = ["13"];

// 事業者種別（N02_002）の除外。1 は新幹線
export const EXCLUDED_OPERATOR_CLASSES: readonly string[] = ["1"];

// 一般に使われる路線の愛称。検索用。キーは正規化後の「事業者キー:路線名」
export const LINE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "jr-west:東海道線": ["JR京都線", "JR神戸線", "琵琶湖線"],
  "jr-west:山陽線": ["JR神戸線"],
  "jr-west:福知山線": ["JR宝塚線"],
  "jr-west:片町線": ["学研都市線"],
  "jr-west:関西線": ["大和路線"],
  "jr-west:桜島線": ["JRゆめ咲線"],
  "jr-west:山陰線": ["嵯峨野線"],
  "jr-west:桜井線": ["万葉まほろば線"],
  "jr-west:大阪環状線": ["環状線"],
  "keifuku:嵐山本線": ["嵐電"],
  "keifuku:北野線": ["嵐電"],
  "kobe-subway:西神線": ["西神・山手線"],
  "kobe-subway:山手線": ["西神・山手線"],
  "kobe-subway:西神延伸線": ["西神・山手線"],
  "osaka-monorail:大阪モノレール線": ["大阪モノレール"],
  "kobe-new-transit:ポートアイランド線": ["ポートライナー"],
  "kobe-new-transit:六甲アイランド線": ["六甲ライナー"],
  "osaka-metro:南港ポートタウン線": ["ニュートラム"],
};

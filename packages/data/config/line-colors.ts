// 路線色の表。各社が公開しているラインカラーの一般に知られた値を手で書いたもの
// ロゴ・ラインマークは使わない。値は近似で、誤りがあればこの表を直す
// 路線の表にないものは事業者の代表色、それもなければ中立色を使う

export const NEUTRAL_LINE_COLOR = "#7F7F7F";

// 事業者の代表色。キーは事業者キー
export const OPERATOR_COLORS: Readonly<Record<string, string>> = {
  "jr-west": "#0072BC",
  hankyu: "#7D1E2B",
  hanshin: "#00559F",
  "osaka-metro": "#0067B0",
  nankai: "#F08300",
  keihan: "#00704A",
  kintetsu: "#D7003A",
  kitakyu: "#E5171F",
  "osaka-monorail": "#0072BC",
  sanyo: "#C8102E",
  "kobe-subway": "#00A040",
  "kyoto-subway": "#00A65C",
  shintetsu: "#E3007F",
  "kobe-new-transit": "#00A0DE",
  hankai: "#2E8B57",
  keifuku: "#7B2D3B",
  eiden: "#8A6D3B",
  nose: "#7A1F2B",
};

// 路線ごとの色。キーは正規化後の「事業者キー:路線名」
export const LINE_COLORS: Readonly<Record<string, string>> = {
  // JR西日本の路線記号の色
  "jr-west:東海道線": "#0072BC",
  "jr-west:山陽線": "#0072BC",
  "jr-west:湖西線": "#00B2E5",
  "jr-west:草津線": "#8DC21F",
  "jr-west:奈良線": "#B5862B",
  "jr-west:山陰線": "#8E2C8E",
  "jr-west:福知山線": "#FFD400",
  "jr-west:JR東西線": "#E4007F",
  "jr-west:片町線": "#E4007F",
  "jr-west:おおさか東線": "#1D2C6B",
  "jr-west:大阪環状線": "#F15A22",
  "jr-west:桜島線": "#E95295",
  "jr-west:関西線": "#00A651",
  "jr-west:阪和線": "#F39700",
  "jr-west:関西空港線": "#1D2088",
  "jr-west:和歌山線": "#E87A90",
  "jr-west:桜井線": "#A6192E",
  // Osaka Metro
  "osaka-metro:御堂筋線": "#E5171F",
  "osaka-metro:谷町線": "#522886",
  "osaka-metro:四つ橋線": "#0078BA",
  "osaka-metro:中央線": "#019A66",
  "osaka-metro:千日前線": "#E44D93",
  "osaka-metro:堺筋線": "#814721",
  "osaka-metro:長堀鶴見緑地線": "#A9CC51",
  "osaka-metro:今里筋線": "#EE7B1A",
  "osaka-metro:南港ポートタウン線": "#00A3D9",
  // 北大阪急行は御堂筋線と直通する
  "kitakyu:南北線": "#E5171F",
  // 近鉄けいはんな線は中央線と直通する
  "kintetsu:けいはんな線": "#019A66",
  // 京都市営地下鉄
  "kyoto-subway:烏丸線": "#00A65C",
  "kyoto-subway:東西線": "#E9551E",
  // 神戸市営地下鉄
  "kobe-subway:西神線": "#00A040",
  "kobe-subway:山手線": "#00A040",
  "kobe-subway:西神延伸線": "#00A040",
  "kobe-subway:北神線": "#00A040",
  "kobe-subway:海岸線": "#0072BC",
};

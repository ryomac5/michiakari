// 大阪市域交通圏のタクシー運賃（普通車・距離制・上限運賃）
// 近畿運輸局の公示から確認した値。確認日: 2026-11-02
// 大阪市域交通圏は公定幅運賃の地域。事業者は上限から下限の範囲で届け出る
// ここでは高めに見積もるため上限運賃を使う

export type TaxiFareSource = {
  title: string;
  url: string;
  checkedOn: string;
};

export const OSAKA_CITY_TAXI_FARE_SOURCES: readonly TaxiFareSource[] = [
  {
    title:
      "近畿運輸局 報道発表「大阪地区のタクシー運賃改定について」（令和7年10月6日、実施日 令和7年11月5日）",
    url: "https://wwwtb.mlit.go.jp/kinki/content/000359487.pdf",
    checkedOn: "2026-11-02",
  },
  {
    title:
      "近畿運輸局 公示「一般乗用旅客自動車運送事業の公定幅運賃の範囲の指定について」（最終改正 令和8年2月13日 近運自二公示第43号）",
    url: "https://wwwtb.mlit.go.jp/kinki/content/kouteihaba.pdf",
    checkedOn: "2026-11-02",
  },
  {
    title:
      "近畿運輸局 公示「タクシーの運賃及び料金に係る初乗距離について」（最終改正 令和8年8月27日 近運自二公示第11号）",
    url: "https://wwwtb.mlit.go.jp/kinki/content/000379518.pdf",
    checkedOn: "2026-11-02",
  },
  {
    title:
      "近畿運輸局 公示「一般乗用旅客自動車運送事業の運賃及び料金に関する制度について」（最終改正 令和8年7月1日 近運旅二公示第6号）",
    url: "https://wwwtb.mlit.go.jp/kinki/content/unntinnseidokouji080701.pdf",
    checkedOn: "2026-11-02",
  },
];

export const OSAKA_CITY_TAXI_FARE = {
  area: "大阪市域交通圏",
  vehicleClass: "普通車",
  fareLevel: "上限運賃",
  // 初乗距離と初乗運賃。出典: 公定幅運賃の公示・初乗距離の公示
  initialDistanceMeters: 1200,
  initialFareYen: 600,
  // 加算距離と加算運賃。出典: 公定幅運賃の公示
  additionalDistanceMeters: 231,
  additionalFareYen: 100,
  // 深夜早朝割増。出典: 運賃及び料金に関する制度の公示 1.(3)ロ②⑤
  // 午後10時以降午前5時まで、割増率2割、距離短縮方式
  // 割増時の距離（初乗 1000 m、加算 193 m）は公示の方式から計算した推定。割増後の距離そのものは未確認
  nightSurcharge: {
    startHour: 22,
    endHour: 5,
    rate: 0.2,
  },
} as const;

export const OSAKA_CITY_TAXI_FARE_LABEL =
  "近畿運輸局が公示する大阪市域交通圏の公定幅運賃（普通車・上限運賃）による概算";

// タクシーの所要時間の概算
// 出典: 開発者の推定（仮）
export const TAXI_TRIP_PARAMS_SOURCE = "開発者の推定（仮）";

// 駅間の直線距離に対する道のりの比。出典: 開発者の推定（仮）
export const TAXI_DETOUR_FACTOR = 1.3;

// 距離帯ごとの平均走行速度（km/h）。信号待ちと渋滞を含む。出典: 開発者の推定（仮）
// 道のりの先頭から順に当てはめる。10 km までは市街地、その先は幹線道路、さらに先は高速道路を想定する
export const TAXI_SPEED_BANDS: readonly { upToKm: number; speedKmh: number }[] = [
  { upToKm: 10, speedKmh: 20 },
  { upToKm: 25, speedKmh: 40 },
  { upToKm: Number.POSITIVE_INFINITY, speedKmh: 70 },
];

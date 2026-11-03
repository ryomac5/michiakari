// 現在地のまわりを手で整えて見せる範囲の設定。いまは大阪駅（梅田一帯）だけを持つ
// ここに書くのは見せ方だけ。徒歩の分数と運行の状態は、路線データと判断から求める

// 吹き出しを駅のどちら側に置くか
export type BubblePlacement = "top" | "bottom" | "left" | "right";
// PC 幅（wide）とスマートフォン幅（narrow）で置き場所を変える
export type Placements = { wide: BubblePlacement; narrow: BubblePlacement };

export type FocusStation = {
  // 吹き出しの識別子。data-testid にも使う
  key: string;
  // 同じ駅として扱う路線データの駅 ID。最初の駅の位置に吹き出しを置く
  stationIds: string[];
  name: { ja: string; en: string };
  // 小さな札の名前。同じ駅名が並ぶとき（阪急と阪神の大阪梅田）は事業者を添えて見分ける
  shortName?: { ja: string; en: string };
  operator: { ja: string; en: string };
  placement: Placements;
  // 小さいほど先に出す。選択肢が使う駅は、これより優先する
  priority: number;
};

export type FocusArea = {
  id: string;
  // この駅名を現在地にしたときに使う
  originNames: string[];
  // 現在地の駅の名前の札
  hereName: { ja: string; en: string };
  // 現在地の札を置く側
  herePlacement: Placements;
  stations: FocusStation[];
};

export const MAX_FOCUS_STATIONS = 4;

export const focusAreas: FocusArea[] = [
  {
    id: "umeda",
    originNames: ["大阪"],
    hereName: { ja: "大阪駅", en: "Osaka Sta." },
    herePlacement: { wide: "left", narrow: "top" },
    stations: [
      {
        key: "metro-umeda",
        stationIds: ["osaka-metro.御堂筋線.梅田"],
        name: { ja: "梅田", en: "Umeda" },
        operator: { ja: "Osaka Metro", en: "Osaka Metro" },
        placement: { wide: "right", narrow: "right" },
        priority: 1,
      },
      {
        key: "hankyu-umeda",
        // 京都線の駅は @repo/geo の網の補正で足したもの
        stationIds: ["hankyu.京都線.大阪梅田", "hankyu.神戸線.大阪梅田", "hankyu.宝塚線.大阪梅田"],
        name: { ja: "大阪梅田", en: "Osaka-umeda" },
        shortName: { ja: "阪急 大阪梅田", en: "Hankyu Umeda" },
        operator: { ja: "阪急", en: "Hankyu" },
        placement: { wide: "top", narrow: "top" },
        priority: 2,
      },
      {
        key: "hanshin-umeda",
        stationIds: ["hanshin.本線.大阪梅田"],
        name: { ja: "大阪梅田", en: "Osaka-umeda" },
        shortName: { ja: "阪神 大阪梅田", en: "Hanshin Umeda" },
        operator: { ja: "阪神", en: "Hanshin" },
        placement: { wide: "bottom", narrow: "bottom" },
        priority: 3,
      },
      {
        key: "kitashinchi",
        stationIds: ["jr-west.JR東西線.北新地"],
        name: { ja: "北新地", en: "Kitashinchi" },
        operator: { ja: "JR西日本", en: "JR West" },
        placement: { wide: "left", narrow: "left" },
        priority: 4,
      },
      {
        key: "higashi-umeda",
        stationIds: ["osaka-metro.谷町線.東梅田"],
        name: { ja: "東梅田", en: "Higashi-Umeda" },
        operator: { ja: "Osaka Metro", en: "Osaka Metro" },
        placement: { wide: "right", narrow: "right" },
        priority: 5,
      },
      {
        key: "nishi-umeda",
        stationIds: ["osaka-metro.四つ橋線.西梅田"],
        name: { ja: "西梅田", en: "Nishi-Umeda" },
        operator: { ja: "Osaka Metro", en: "Osaka Metro" },
        placement: { wide: "left", narrow: "left" },
        priority: 6,
      },
    ],
  },
];

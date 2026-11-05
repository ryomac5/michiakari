import type { Localized } from "./areas";

// 方面の呼び名を手で整える設定。大阪のまわりの主な路線だけを書く
// ここに書くのは呼び名と直通先だけ。駅の並びと位置は駅データから引く
// 書いていない路線は、先の駅のうち乗降客数の多い 2 駅を並べて呼ぶ

export type DirectionLandmark = {
  // 駅データの駅名
  station: string;
  // 駅名と違う呼び名で見せるとき
  label?: Localized;
};

export type DirectionLabelConfig = {
  lineId: string;
  // 路線データでの方面の終わりの駅名
  terminal: string;
  // 方面の名前に出す駅。先にある駅のうち、前から 2 つを使う
  landmarks: DirectionLandmark[];
  // 終わりの駅から直通する路線。その路線の先の駅も行き先の候補に足す
  throughLineId?: string;
};

export const directionLabels: DirectionLabelConfig[] = [
  { lineId: "kintetsu.京都線", terminal: "京都", landmarks: [{ station: "京都" }] },
  {
    lineId: "kintetsu.京都線",
    terminal: "大和西大寺",
    landmarks: [{ station: "大和西大寺" }, { station: "橿原神宮前" }],
    throughLineId: "kintetsu.橿原線",
  },
  {
    lineId: "keihan.京阪本線",
    terminal: "淀屋橋",
    landmarks: [{ station: "枚方市" }, { station: "淀屋橋" }],
  },
  {
    lineId: "keihan.京阪本線",
    terminal: "三条",
    landmarks: [{ station: "三条" }, { station: "出町柳" }],
    throughLineId: "keihan.鴨東線",
  },
  {
    lineId: "kyoto-subway.烏丸線",
    terminal: "国際会館",
    landmarks: [{ station: "四条" }, { station: "国際会館" }],
  },
  {
    lineId: "kyoto-subway.烏丸線",
    terminal: "竹田",
    landmarks: [{ station: "京都" }, { station: "竹田" }],
  },
  {
    lineId: "kyoto-subway.東西線",
    terminal: "六地蔵",
    landmarks: [{ station: "山科" }, { station: "六地蔵" }],
  },
  {
    lineId: "kyoto-subway.東西線",
    terminal: "太秦天神川",
    landmarks: [{ station: "二条" }, { station: "太秦天神川" }],
  },
  {
    lineId: "hanshin.本線",
    terminal: "大阪梅田",
    landmarks: [{ station: "尼崎" }, { station: "大阪梅田" }],
  },
  {
    lineId: "hanshin.本線",
    terminal: "元町",
    landmarks: [{ station: "元町" }, { station: "高速神戸" }],
    throughLineId: "hanshin.神戸高速線",
  },
  { lineId: "hankyu.神戸高速線", terminal: "神戸三宮", landmarks: [{ station: "神戸三宮" }] },
  {
    lineId: "hankyu.神戸高速線",
    terminal: "新開地",
    landmarks: [{ station: "高速神戸" }, { station: "新開地" }],
  },
  { lineId: "hanshin.神戸高速線", terminal: "元町", landmarks: [{ station: "元町" }] },
  {
    lineId: "hanshin.神戸高速線",
    terminal: "西代",
    landmarks: [{ station: "新開地" }, { station: "西代" }],
  },
  {
    lineId: "kobe-subway.山手線",
    terminal: "新神戸",
    landmarks: [{ station: "新神戸" }, { station: "谷上" }],
    throughLineId: "kobe-subway.北神線",
  },
  {
    lineId: "kobe-subway.山手線",
    terminal: "新長田",
    landmarks: [{ station: "新長田" }, { station: "名谷" }],
    throughLineId: "kobe-subway.西神線",
  },
  {
    lineId: "kobe-subway.海岸線",
    terminal: "新長田",
    landmarks: [{ station: "ハーバーランド" }, { station: "新長田" }],
  },
  {
    lineId: "kobe-subway.海岸線",
    terminal: "三宮・花時計前",
    landmarks: [{ station: "三宮・花時計前" }],
  },
  {
    lineId: "kobe-new-transit.ポートアイランド線",
    terminal: "神戸空港",
    landmarks: [{ station: "市民広場" }, { station: "神戸空港" }],
  },
  {
    lineId: "kobe-new-transit.ポートアイランド線",
    terminal: "三宮",
    landmarks: [{ station: "三宮" }],
  },
  {
    lineId: "osaka-metro.御堂筋線",
    terminal: "江坂",
    landmarks: [{ station: "新大阪" }, { station: "千里中央" }],
    throughLineId: "kitakyu.南北線",
  },
  {
    lineId: "osaka-metro.御堂筋線",
    terminal: "中百舌鳥",
    landmarks: [
      { station: "天王寺" },
      { station: "中百舌鳥", label: { ja: "なかもず", en: "Nakamozu" } },
    ],
  },
  {
    lineId: "jr-west.東海道線",
    terminal: "篠原",
    landmarks: [{ station: "新大阪" }, { station: "京都" }, { station: "草津" }],
  },
  {
    lineId: "jr-west.東海道線",
    terminal: "神戸",
    landmarks: [
      { station: "大阪" },
      { station: "尼崎" },
      { station: "三ノ宮" },
      { station: "神戸" },
    ],
  },
  { lineId: "hankyu.京都線", terminal: "京都河原町", landmarks: [{ station: "京都河原町" }] },
  { lineId: "hankyu.宝塚線", terminal: "宝塚", landmarks: [{ station: "宝塚" }] },
  { lineId: "hankyu.神戸線", terminal: "神戸三宮", landmarks: [{ station: "神戸三宮" }] },
  ...["hankyu.京都線", "hankyu.宝塚線", "hankyu.神戸線"].map((lineId) => ({
    lineId,
    terminal: "大阪梅田",
    landmarks: [{ station: "十三" }, { station: "大阪梅田" }],
  })),
];

// JR の通称ごとに、先に出す方面。その通称の区間にある駅を含む方面を先頭にする
export const preferredDirectionStation: Record<string, string> = {
  JR京都線: "京都",
  JR神戸線: "三ノ宮",
  琵琶湖線: "草津",
};

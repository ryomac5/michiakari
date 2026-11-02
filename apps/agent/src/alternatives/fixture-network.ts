import type { LineType } from "@repo/core";

// 開発用の簡易ネットワーク。WS1（packages/geo）が来るまでの代用
// 駅の座標は開発者が手で入れた概算値（数百 m の誤差を含む）。国土数値情報の値ではない
// 同じ名前の駅は 1 つの駅として扱い、乗り換えの徒歩を 0 分とみなす

export type FixtureStation = {
  name: string;
  lon: number;
  lat: number;
};

export type FixtureLine = {
  name: string;
  operator: string;
  lineType: LineType;
  // 路線上の並び順
  stations: readonly string[];
};

export type FixtureNetwork = {
  stations: readonly FixtureStation[];
  lines: readonly FixtureLine[];
};

export const FIXTURE_NETWORK: FixtureNetwork = {
  stations: [
    { name: "大阪", lon: 135.4959, lat: 34.7025 },
    { name: "大阪梅田", lon: 135.4983, lat: 34.7052 },
    { name: "梅田", lon: 135.499, lat: 34.703 },
    { name: "新大阪", lon: 135.5001, lat: 34.7334 },
    { name: "十三", lon: 135.4823, lat: 34.72 },
    { name: "淡路", lon: 135.5172, lat: 34.7445 },
    { name: "高槻", lon: 135.6175, lat: 34.8516 },
    { name: "高槻市", lon: 135.6178, lat: 34.8487 },
    { name: "山崎", lon: 135.6797, lat: 34.8917 },
    { name: "長岡天神", lon: 135.696, lat: 34.926 },
    { name: "桂", lon: 135.709, lat: 34.9822 },
    { name: "烏丸", lon: 135.7597, lat: 35.0037 },
    { name: "京都河原町", lon: 135.769, lat: 35.0037 },
    { name: "四条", lon: 135.7597, lat: 35.0033 },
    { name: "五条", lon: 135.7597, lat: 34.996 },
    { name: "京都", lon: 135.7588, lat: 34.9858 },
    { name: "淀屋橋", lon: 135.5014, lat: 34.6925 },
    { name: "京橋", lon: 135.534, lat: 34.6966 },
    { name: "枚方市", lon: 135.6497, lat: 34.816 },
    { name: "樟葉", lon: 135.68, lat: 34.863 },
    { name: "中書島", lon: 135.76, lat: 34.93 },
    { name: "丹波橋", lon: 135.765, lat: 34.94 },
    { name: "七条", lon: 135.768, lat: 34.9897 },
    { name: "祇園四条", lon: 135.772, lat: 35.0035 },
    { name: "尼崎", lon: 135.4227, lat: 34.734 },
    { name: "伊丹", lon: 135.421, lat: 34.7797 },
    { name: "川西池田", lon: 135.417, lat: 34.8228 },
    { name: "宝塚", lon: 135.3427, lat: 34.8106 },
    { name: "三田", lon: 135.2253, lat: 34.8897 },
    { name: "甲子園口", lon: 135.3657, lat: 34.739 },
    { name: "西宮", lon: 135.3412, lat: 34.7376 },
    { name: "芦屋", lon: 135.306, lat: 34.734 },
    { name: "住吉", lon: 135.262, lat: 34.7203 },
    { name: "六甲道", lon: 135.239, lat: 34.714 },
    { name: "三ノ宮", lon: 135.1951, lat: 34.6946 },
    { name: "神戸", lon: 135.1781, lat: 34.6795 },
    { name: "塚口", lon: 135.417, lat: 34.752 },
    { name: "西宮北口", lon: 135.3606, lat: 34.7472 },
    { name: "夙川", lon: 135.327, lat: 34.744 },
    { name: "岡本", lon: 135.2763, lat: 34.7257 },
    { name: "御影", lon: 135.254, lat: 34.723 },
    { name: "神戸三宮", lon: 135.1956, lat: 34.6933 },
    { name: "新開地", lon: 135.17, lat: 34.6795 },
    { name: "鈴蘭台", lon: 135.147, lat: 34.726 },
    { name: "有馬口", lon: 135.219, lat: 34.792 },
  ],
  lines: [
    {
      name: "JR京都線",
      operator: "JR西日本",
      lineType: "jr_rapid",
      stations: ["大阪", "新大阪", "高槻", "山崎", "京都"],
    },
    {
      name: "JR宝塚線",
      operator: "JR西日本",
      lineType: "jr_rapid",
      stations: ["大阪", "尼崎", "伊丹", "川西池田", "宝塚", "三田"],
    },
    {
      name: "JR神戸線",
      operator: "JR西日本",
      lineType: "jr_local",
      stations: ["大阪", "尼崎", "甲子園口", "西宮", "芦屋", "住吉", "六甲道", "三ノ宮", "神戸"],
    },
    {
      name: "阪急京都線",
      operator: "阪急電鉄",
      lineType: "private_express",
      stations: ["大阪梅田", "十三", "淡路", "高槻市", "長岡天神", "桂", "烏丸", "京都河原町"],
    },
    {
      name: "阪急神戸線",
      operator: "阪急電鉄",
      lineType: "private_express",
      stations: ["大阪梅田", "十三", "塚口", "西宮北口", "夙川", "岡本", "御影", "神戸三宮"],
    },
    {
      name: "阪急今津線",
      operator: "阪急電鉄",
      lineType: "private_local",
      stations: ["宝塚", "西宮北口"],
    },
    {
      name: "京阪本線",
      operator: "京阪電気鉄道",
      lineType: "private_express",
      stations: ["淀屋橋", "京橋", "枚方市", "樟葉", "中書島", "丹波橋", "七条", "祇園四条"],
    },
    {
      name: "御堂筋線",
      operator: "Osaka Metro",
      lineType: "subway",
      stations: ["梅田", "淀屋橋"],
    },
    {
      name: "烏丸線",
      operator: "京都市営地下鉄",
      lineType: "subway",
      stations: ["四条", "五条", "京都"],
    },
    {
      name: "神戸高速線",
      operator: "神戸高速鉄道",
      lineType: "private_local",
      stations: ["神戸三宮", "新開地"],
    },
    {
      name: "神戸電鉄",
      operator: "神戸電鉄",
      lineType: "private_local",
      stations: ["新開地", "鈴蘭台", "有馬口", "三田"],
    },
  ],
};

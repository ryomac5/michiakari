// 地図の文言。messages/ が WS6 の変更範囲外のため、ここで言語ごとに持つ

export type MapLabels = {
  origin: string;
  destination: string;
  blocked: string;
  loading: string;
  error: string;
  legend: {
    title: string;
    blocked: string;
    reach: string;
    approx: string;
    route: string;
    alternative: string;
    places: string;
  };
  // 一覧で選んだ経路を地図に描いていることを示す札
  selectedRoute: string;
  // 地図を推奨経路と区間の全体に戻すボタン
  recenter: string;
  // 徒歩の道と到達範囲の札
  walkLabel: (minutes: number) => string;
  // 地図の隅の出典。short は画面幅 390px でも 1 行に収まる短い表記、full は読み上げ用の全文
  attribution: { short: string; full: string[]; link: string };
  gestures: { windows: string; mac: string; mobile: string };
};

const ja: MapLabels = {
  origin: "現在地",
  destination: "行き先",
  blocked: "運転見合わせ",
  loading: "地図を読み込んでいます",
  error: "地図はもう一度開くと表示されます",
  legend: {
    title: "地図の見方",
    blocked: "止まっている区間",
    reach: "徒歩20分の範囲。点線は10分",
    approx: "概算",
    route: "地図に描いている経路。一覧で選び直せる",
    alternative: "ほかの選択肢",
    places: "出発と行き先",
  },
  selectedRoute: "表示中",
  recenter: "経路の全体を表示",
  walkLabel: (minutes) => `徒歩 ${minutes} 分`,
  attribution: {
    short: "国土地理院 / © OpenStreetMap contributors / 国土数値情報",
    full: [
      "地図: 国土地理院 / © OpenStreetMap contributors",
      "徒歩経路・到達範囲: © OpenStreetMap contributors のデータから Valhalla で計算",
      "鉄道・駅の乗降客数: 「国土数値情報」（国土交通省）を加工して作成",
    ],
    link: "出典",
  },
  gestures: {
    windows: "Ctrl キーを押しながらスクロールで拡大・縮小",
    mac: "⌘ キーを押しながらスクロールで拡大・縮小",
    mobile: "2本の指で地図を動かせます",
  },
};

const en: MapLabels = {
  origin: "You",
  destination: "Destination",
  blocked: "Suspended",
  loading: "Loading map",
  error: "The map could not be shown",
  legend: {
    title: "Reading the map",
    blocked: "Suspended section",
    reach: "20 min walk. Dotted is 10 min",
    approx: "approx.",
    route: "Route shown on the map. Pick another in the list",
    alternative: "Other options",
    places: "Start and destination",
  },
  selectedRoute: "Showing",
  recenter: "Show the whole route",
  walkLabel: (minutes) => `${minutes} min walk`,
  attribution: {
    short: "GSI Japan / © OpenStreetMap contributors / MLIT",
    full: [
      "Map: Geospatial Information Authority of Japan / © OpenStreetMap contributors",
      "Walking routes and ranges: computed with Valhalla from © OpenStreetMap contributors data",
      "Railway and ridership data: processed from National Land Numerical Information, MLIT Japan",
    ],
    link: "Sources",
  },
  gestures: {
    windows: "Hold Ctrl and scroll to zoom the map",
    mac: "Hold ⌘ and scroll to zoom the map",
    mobile: "Use two fingers to move the map",
  },
};

export function selectMapLabels(locale: string): MapLabels {
  return locale === "en" ? en : ja;
}

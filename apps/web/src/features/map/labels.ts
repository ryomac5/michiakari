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
    reachable: string;
    route: string;
    transfer: string;
  };
  attribution: string[];
  gestures: { windows: string; mac: string; mobile: string };
};

const ja: MapLabels = {
  origin: "現在地",
  destination: "行き先",
  blocked: "運転見合わせ",
  loading: "地図を読み込んでいます",
  error: "地図を表示できませんでした",
  legend: {
    title: "凡例",
    blocked: "止まっている区間",
    reach: "徒歩10分・20分の範囲",
    approx: "概算",
    reachable: "徒歩圏で動いている駅",
    route: "推奨経路。点線は徒歩",
    transfer: "振替輸送の対象路線",
  },
  attribution: [
    "地図: 国土地理院 / © OpenStreetMap contributors",
    // 地図の高さを食わないよう、鉄道と乗降客数の 2 行を 1 行にまとめる。全文は「このアプリについて」
    "鉄道・駅の乗降客数: 「国土数値情報」（国土交通省）を加工して作成",
  ],
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
    title: "Legend",
    blocked: "Suspended section",
    reach: "10 and 20 min walk",
    approx: "approx.",
    reachable: "Running stations within walking range",
    route: "Recommended route. Dotted is walking",
    transfer: "Lines accepting transfer tickets",
  },
  attribution: [
    "Map: Geospatial Information Authority of Japan / © OpenStreetMap contributors",
    "Railway and ridership data: processed from National Land Numerical Information, MLIT Japan",
  ],
  gestures: {
    windows: "Hold Ctrl and scroll to zoom the map",
    mac: "Hold ⌘ and scroll to zoom the map",
    mobile: "Use two fingers to move the map",
  },
};

export function selectMapLabels(locale: string): MapLabels {
  return locale === "en" ? en : ja;
}

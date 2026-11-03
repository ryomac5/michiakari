// 入口の地図で手で整えて見せるエリアの設定。大阪のまわりを先に磨く
// ここに書くのは見せ方だけ。駅の位置・路線・路線色は国土数値情報の駅データから引く

export type Localized = { ja: string; en: string };

// 名前の札を丸のどちら側に出すか。PC 幅（wide）とスマートフォン幅（narrow）で変える
export type LabelSide = "left" | "right" | "top" | "bottom";
export type Sides = { wide: LabelSide; narrow: LabelSide };

export type EntryPlaceConfig = {
  // 丸の識別子。data-testid にも使う
  key: string;
  // 1 つの丸にまとめる駅名（駅データのまとまりの識別子）。丸は先頭の駅の位置に置く
  stationNames: string[];
  // 駅名と違う名前で見せるとき。無ければ先頭の駅の名前
  label?: Localized;
  side: Sides;
};

export type EntryAreaConfig = {
  id: string;
  // シートの見出しに出すエリアの名前
  name: Localized;
  // 関西の段に出す大きな丸。core は大阪の中心で、狭い画面ではこの丸が収まるように寄せる
  hub: { label: Localized; stationName: string; side: Sides; core: boolean };
  places: EntryPlaceConfig[];
};

const both = (side: LabelSide): Sides => ({ wide: side, narrow: side });

export const entryAreas: EntryAreaConfig[] = [
  {
    id: "umeda",
    name: { ja: "梅田・大阪", en: "Umeda & Osaka" },
    hub: {
      label: { ja: "大阪", en: "Osaka" },
      stationName: "大阪",
      core: true,
      side: both("right"),
    },
    places: [
      { key: "osaka", stationNames: ["大阪"], side: both("left") },
      { key: "umeda", stationNames: ["梅田"], side: both("right") },
      { key: "osaka-umeda", stationNames: ["大阪梅田"], side: both("top") },
      { key: "higashi-umeda", stationNames: ["東梅田"], side: both("right") },
      { key: "nishi-umeda", stationNames: ["西梅田"], side: both("left") },
      { key: "kitashinchi", stationNames: ["北新地"], side: both("bottom") },
    ],
  },
  {
    id: "shin-osaka",
    name: { ja: "新大阪", en: "Shin-Osaka" },
    hub: {
      label: { ja: "新大阪", en: "Shin-Osaka" },
      stationName: "新大阪",
      core: true,
      side: both("left"),
    },
    places: [
      { key: "shin-osaka", stationNames: ["新大阪"], side: both("right") },
      {
        key: "nishinakajima",
        stationNames: ["西中島南方", "南方"],
        label: { ja: "西中島南方・南方", en: "Nishinakajima" },
        side: both("left"),
      },
      {
        key: "higashi-mikuni",
        stationNames: ["東三国"],
        label: { ja: "東三国", en: "Higashi-Mikuni" },
        side: both("right"),
      },
      {
        key: "higashi-yodogawa",
        stationNames: ["東淀川"],
        label: { ja: "東淀川", en: "Higashi-Yodogawa" },
        side: both("right"),
      },
    ],
  },
  {
    id: "namba",
    name: { ja: "なんば", en: "Namba" },
    hub: {
      label: { ja: "難波", en: "Namba" },
      stationName: "難波",
      core: true,
      side: both("left"),
    },
    places: [
      { key: "namba", stationNames: ["難波"], side: both("left") },
      { key: "osaka-namba", stationNames: ["大阪難波"], side: both("top") },
      {
        key: "nippombashi",
        stationNames: ["日本橋", "近鉄日本橋"],
        side: both("right"),
      },
      { key: "jr-namba", stationNames: ["JR難波"], side: both("left") },
      { key: "shinsaibashi", stationNames: ["心斎橋"], side: both("right") },
    ],
  },
  {
    id: "tennoji",
    name: { ja: "天王寺・阿倍野", en: "Tennoji & Abeno" },
    hub: {
      label: { ja: "天王寺", en: "Tennoji" },
      stationName: "天王寺",
      core: true,
      side: both("right"),
    },
    places: [
      { key: "tennoji", stationNames: ["天王寺"], side: both("left") },
      { key: "abenobashi", stationNames: ["大阪阿部野橋"], side: both("right") },
      {
        key: "abeno",
        stationNames: ["阿倍野"],
        label: { ja: "阿倍野", en: "Abeno" },
        side: both("right"),
      },
      { key: "dobutsuen-mae", stationNames: ["動物園前"], side: both("left") },
      {
        key: "teradacho",
        stationNames: ["寺田町"],
        label: { ja: "寺田町", en: "Teradacho" },
        side: both("right"),
      },
    ],
  },
  {
    id: "kyoto",
    name: { ja: "京都駅のまわり", en: "Around Kyoto Sta." },
    hub: {
      label: { ja: "京都", en: "Kyoto" },
      stationName: "京都",
      core: false,
      side: both("left"),
    },
    places: [
      { key: "kyoto", stationNames: ["京都"], side: both("right") },
      {
        key: "toji",
        stationNames: ["東寺"],
        label: { ja: "東寺", en: "Toji" },
        side: both("left"),
      },
      {
        key: "kujo",
        stationNames: ["九条"],
        label: { ja: "九条", en: "Kujo" },
        side: both("bottom"),
      },
      {
        key: "shichijo",
        stationNames: ["七条"],
        label: { ja: "七条", en: "Shichijo" },
        side: both("right"),
      },
      {
        key: "gojo",
        stationNames: ["五条"],
        label: { ja: "五条", en: "Gojo" },
        side: both("left"),
      },
    ],
  },
  {
    id: "sannomiya",
    name: { ja: "三宮", en: "Sannomiya" },
    hub: {
      label: { ja: "三ノ宮", en: "Sannomiya" },
      stationName: "三ノ宮",
      core: false,
      side: both("right"),
    },
    places: [
      {
        // JR・阪急・阪神・地下鉄で駅名が違うが、利用者には 1 つの三宮として見せる
        key: "sannomiya",
        stationNames: ["三ノ宮", "神戸三宮", "三宮"],
        label: { ja: "三宮", en: "Sannomiya" },
        side: both("right"),
      },
      {
        key: "hanadokei-mae",
        stationNames: ["三宮・花時計前"],
        label: { ja: "三宮・花時計前", en: "Sannomiya-Hanadokeimae" },
        side: both("bottom"),
      },
      { key: "motomachi", stationNames: ["元町"], side: both("left") },
    ],
  },
];

// 行き先の候補に出す駅。関西の段の丸と同じ顔ぶれにする
export function listDestinationSuggestions(): { id: string; stationName: string }[] {
  return entryAreas.map((a) => ({ id: a.id, stationName: a.hub.stationName }));
}

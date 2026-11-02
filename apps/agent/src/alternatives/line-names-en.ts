import { normalizeSearchText } from "@repo/geo";

// 利用者や発表が使う路線の通称と英語名。路線データの正式名とずれるものだけを持つ
// 路線データの英語名で足りるもの（阪急京都線など）は geo の英語名を使う

const LINE_NICKNAMES_EN: Readonly<Record<string, string>> = {
  JR京都線: "JR Kyoto Line",
  JR神戸線: "JR Kobe Line",
  JR宝塚線: "JR Takarazuka Line",
  JR琵琶湖線: "JR Biwako Line",
  JR学研都市線: "JR Gakkentoshi Line",
  JR大和路線: "JR Yamatoji Line",
  JR嵯峨野線: "JR Sagano Line",
  JRゆめ咲線: "JR Yumesaki Line",
  JR東西線: "JR Tozai Line",
  JR大阪環状線: "JR Osaka Loop Line",
  大阪環状線: "JR Osaka Loop Line",
  JRおおさか東線: "JR Osaka Higashi Line",
  JR阪和線: "JR Hanwa Line",
  JR関西空港線: "JR Kansai Airport Line",
  JR奈良線: "JR Nara Line",
  JR湖西線: "JR Kosei Line",
};

// 「京都線」のように事業者を省いた名前は阪急などと紛れるので、表のとおりの名前だけを引く
const NICKNAME_INDEX = new Map(
  Object.entries(LINE_NICKNAMES_EN).map(([ja, en]) => [normalizeSearchText(ja), en] as const),
);

// 通称の英語名。表に無ければ null
export function findLineNicknameEn(name: string): string | null {
  return NICKNAME_INDEX.get(normalizeSearchText(name)) ?? null;
}

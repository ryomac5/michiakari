// バスの事業者名の表示と公式の案内。P11 の事業者名を表示用の名前に付け替える
// URL は 2026-11-05 に開けることを確かめた事業者のトップか路線案内のページだけを置く
// 時刻や運行情報のページへの深いリンクは作らない。表にない事業者は案内のリンクを出さない

export type BusOperatorEntry = {
  // P11_002 の値
  raw: string;
  name: string;
  url: string;
};

export const BUS_OPERATORS: readonly BusOperatorEntry[] = [
  { raw: "大阪シティバス（株）", name: "大阪シティバス", url: "https://citybus-osaka.co.jp/" },
  { raw: "阪急バス（株）", name: "阪急バス", url: "https://www.hankyubus.co.jp/" },
  { raw: "京阪バス（株）", name: "京阪バス", url: "https://www.keihanbus.jp/" },
  { raw: "近鉄バス（株）", name: "近鉄バス", url: "https://www.kintetsu-bus.co.jp/" },
  { raw: "南海バス（株）", name: "南海バス", url: "https://www.nankaibus.jp/" },
  { raw: "阪神バス（株）", name: "阪神バス", url: "https://www.hanshin-bus.co.jp/" },
  { raw: "京都バス（株）", name: "京都バス", url: "https://www.kyotobus.jp/" },
  { raw: "神姫バス（株）", name: "神姫バス", url: "https://www.shinkibus.co.jp/" },
  { raw: "奈良交通（株）", name: "奈良交通", url: "https://www.narakotsu.co.jp/" },
  { raw: "近江鉄道（株）", name: "近江鉄道バス", url: "https://www.ohmitetudo.co.jp/bus/" },
  { raw: "湖国バス（株）", name: "湖国バス", url: "https://www.ohmitetudo.co.jp/bus/" },
  { raw: "和歌山バス（株）", name: "和歌山バス", url: "https://www.wakayamabus.co.jp/" },
  { raw: "全但バス（株）", name: "全但バス", url: "https://www.zentanbus.co.jp/" },
  { raw: "京都市", name: "京都市バス", url: "https://www.city.kyoto.lg.jp/kotsu/" },
  { raw: "神戸市", name: "神戸市バス", url: "https://kotsu.city.kobe.lg.jp/" },
];

// 表にない事業者は会社の種類の表記だけを外して出す
export function normalizeBusOperatorName(raw: string): string {
  const entry = BUS_OPERATORS.find((o) => o.raw === raw);
  if (entry) return entry.name;
  return raw.replaceAll(/（株）|\(株\)|株式会社/g, "").trim() || raw;
}

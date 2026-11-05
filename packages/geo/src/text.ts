// 駅名検索のための表記の正規化
// 全角半角をそろえ、カタカナをひらがなにし、末尾の「駅」を除く
// 漢字に挟まれた「ノ」「ケ」「ヶ」などは地名の表記揺れとして除く（三ノ宮と三宮、霞ヶ関と霞が関）
// 仮名だけの読み（サンノミヤ）の「ノ」は漢字に挟まれないので残る

const KATAKANA_TO_HIRAGANA_OFFSET = 0x60;

// 地名で漢字のあいだに入る助詞の揺れ。ノ・の、ケ・ヶ・ヵ・が・ガ
const PLACE_PARTICLE_BETWEEN_KANJI = /(?<=\p{Script=Han})[ノのケヶヵがガ](?=\p{Script=Han})/gu;

function convertKatakanaToHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - KATAKANA_TO_HIRAGANA_OFFSET),
  );
}

export function normalizeSearchText(text: string): string {
  const base = text
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .replace(/駅$/, "")
    .replace(PLACE_PARTICLE_BETWEEN_KANJI, "")
    .toLowerCase();
  return convertKatakanaToHiragana(base);
}

// 駅名検索のための表記の正規化
// 全角半角をそろえ、カタカナをひらがなにし、末尾の「駅」と「ノ」「ヶ」「ケ」を除く

const KATAKANA_TO_HIRAGANA_OFFSET = 0x60;

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
    .replace(/[ノヶケ]/g, "")
    .toLowerCase();
  return convertKatakanaToHiragana(base);
}

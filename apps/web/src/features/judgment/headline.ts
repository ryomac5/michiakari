// 結論の見出しの整形。短く大きく出し、長いときは文字を段階的に小さくする

// 見出しの文字サイズ（rem）。大きい順に試し、行数の上限に収まった最初の大きさを使う
export const headlineSizesRem = [2.25, 2, 1.75, 1.5, 1.3125, 1.125] as const;
export const headlineMaxLines = 4;
// 大きさを選ぶ段。上の段から順に、行数の条件を満たす最も大きい文字を探す
// 2 行に収まるなら大きく、無理なら 3 行・4 行と許す代わりに文字を小さくする
export const headlineFitTiers = [
  { maxLines: 2, minRem: 1.5 },
  { maxLines: 3, minRem: 1.3125 },
  { maxLines: headlineMaxLines, minRem: 0 },
] as const;

// 各大きさで測った行数から、使う大きさの番号を選ぶ
export function chooseHeadlineSize(linesBySize: readonly number[]): number {
  for (const tier of headlineFitTiers) {
    const index = headlineSizesRem.findIndex(
      (rem, i) =>
        rem >= tier.minRem && (linesBySize[i] ?? Number.POSITIVE_INFINITY) <= tier.maxLines,
    );
    if (index !== -1) return index;
  }
  return headlineSizesRem.length - 1;
}

// 和文は 1 字、英数字は約 0.55 字ぶんの幅として数える
export function measureHeadlineWeight(text: string): number {
  let weight = 0;
  for (const ch of text) weight += /[\x20-\x7e]/.test(ch) ? 0.55 : 1;
  return weight;
}

// 測る前の当て推量。幅 300px 前後の結論カードで行数の上限に収まる大きさを選ぶ
export function pickInitialHeadlineSize(text: string, widthPx = 300): number {
  const weight = measureHeadlineWeight(text);
  const index = headlineSizesRem.findIndex((rem) => {
    const perLine = Math.floor(widthPx / (rem * 17));
    return Math.ceil(weight / Math.max(1, perLine)) <= headlineMaxLines - 1;
  });
  return index === -1 ? headlineSizesRem.length - 1 : index;
}

// 2 文以上の見出しは、最初の 1 文を見出しにし、残りを理由として下に回す
export function splitHeadline(headline: string): { lead: string; rest: string | null } {
  const text = headline.trim();
  const match = /^(.+?[。！？]|.+?[.!?](?=\s))\s*(.+)$/su.exec(text);
  if (!match) return { lead: text, rest: null };
  return { lead: (match[1] as string).trim(), rest: (match[2] as string).trim() };
}

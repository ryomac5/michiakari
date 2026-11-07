// 文の中の時刻と、数と単位の組を、途中で改行しない範囲として切り出す
// 「22時」と「46分」の間や、「1」と「時間」の間で折れると読み違えやすい

export type TextRun = { text: string; keep: boolean };

const unbreakablePatterns = [
  // 分の幅。「10〜15分ほど」「6–10 min」
  String.raw`約?\d+〜\d+\s?分(?:ほど)?`,
  String.raw`\d+–\d+\s?(?:minutes?|mins?|min)\b`,
  // 日本語の時刻と時間。「22時46分頃」「1時間30分」「約25分」
  String.raw`約?\d{1,2}時\d{1,2}分(?:頃|ごろ)?`,
  String.raw`約?\d+(?:\.\d+)?\s?時間(?:\d{1,2}\s?分)?(?:半|ほど)?`,
  String.raw`\d{1,2}時(?:台|頃|ごろ)?`,
  // 24 時間表記と午前午後の表記。「21:40」「9:05 pm」
  String.raw`\d{1,2}:\d{2}(?:\s?(?:[ap]m\b|[ap]\.m\.))?(?!\d)`,
  // 英語の時間。「1 h 20 min」「25 minutes」
  String.raw`\d+\s?(?:h|hours?|hrs?)\s\d+\s?(?:min|mins|minutes?)\b`,
  String.raw`\d+(?:\.\d+)?\s?(?:hours?|hrs?|h|minutes?|mins?|min|seconds?|secs?|yen|km)\b`,
  String.raw`¥\s?\d[\d,]*`,
  // 日本語の数と単位
  String.raw`約?\d[\d,]*(?:\.\d+)?\s?(?:分|秒|円|キロ|km|メートル|本|駅|件|人|%)`,
];

const unbreakablePattern = new RegExp(unbreakablePatterns.join("|"), "gu");

export function splitUnbreakableRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  for (const match of text.matchAll(unbreakablePattern)) {
    const index = match.index ?? 0;
    if (index > last) runs.push({ text: text.slice(last, index), keep: false });
    runs.push({ text: match[0], keep: true });
    last = index + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), keep: false });
  return runs;
}

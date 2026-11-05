// ひらがなの読みをヘボン式のローマ字にする。駅名の英語表記の既定値に使う
// 長音は省く（おお・おう → o、うう → u）。撥音は b・m・p の前で m にする

// biome-ignore format: 五十音の並びを保つ
const KANA: Readonly<Record<string, string>> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", を: "o",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
  てぃ: "ti", でぃ: "di", ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
  じぇ: "je", しぇ: "she", ちぇ: "che",
};

function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// 長音として省く母音か。直前の母音が o なら う・お、u なら う を省く
function isLongVowel(previous: string, syllable: string): boolean {
  const last = previous.at(-1);
  return (
    (last === "o" && (syllable === "u" || syllable === "o")) || (last === "u" && syllable === "u")
  );
}

function splitSyllables(reading: string): string[] {
  const syllables: string[] = [];
  let i = 0;
  while (i < reading.length) {
    const pair = reading.slice(i, i + 2);
    if (KANA[pair] !== undefined) {
      syllables.push(pair);
      i += 2;
    } else {
      syllables.push(reading[i] as string);
      i += 1;
    }
  }
  return syllables;
}

export function romanizeReading(reading: string): string {
  const syllables = splitSyllables(toHiragana(reading));
  let result = "";
  for (let i = 0; i < syllables.length; i++) {
    const kana = syllables[i] as string;
    const next = KANA[syllables[i + 1] ?? ""] ?? "";
    if (kana === "っ") {
      result += next.startsWith("ch") ? "t" : next.charAt(0);
      continue;
    }
    if (kana === "ん") {
      result += /^[bmp]/.test(next) ? "m" : "n";
      continue;
    }
    if (kana === "ー") continue;
    const romaji = KANA[kana];
    if (romaji === undefined)
      throw new Error(`ローマ字にできない文字があります: ${kana}（${reading}）`);
    if (isLongVowel(result, romaji)) continue;
    result += romaji;
  }
  return result.charAt(0).toUpperCase() + result.slice(1);
}

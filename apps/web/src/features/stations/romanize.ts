// 駅名の読み（ひらがな）を英語画面向けのローマ字にする。駅の案内表示に近いヘボン式で、長音記号は付けない

const syllables: Record<string, string> = {
  あ: "a",
  い: "i",
  う: "u",
  え: "e",
  お: "o",
  か: "ka",
  き: "ki",
  く: "ku",
  け: "ke",
  こ: "ko",
  さ: "sa",
  し: "shi",
  す: "su",
  せ: "se",
  そ: "so",
  た: "ta",
  ち: "chi",
  つ: "tsu",
  て: "te",
  と: "to",
  な: "na",
  に: "ni",
  ぬ: "nu",
  ね: "ne",
  の: "no",
  は: "ha",
  ひ: "hi",
  ふ: "fu",
  へ: "he",
  ほ: "ho",
  ま: "ma",
  み: "mi",
  む: "mu",
  め: "me",
  も: "mo",
  や: "ya",
  ゆ: "yu",
  よ: "yo",
  ら: "ra",
  り: "ri",
  る: "ru",
  れ: "re",
  ろ: "ro",
  わ: "wa",
  ゐ: "i",
  ゑ: "e",
  を: "o",
  が: "ga",
  ぎ: "gi",
  ぐ: "gu",
  げ: "ge",
  ご: "go",
  ざ: "za",
  じ: "ji",
  ず: "zu",
  ぜ: "ze",
  ぞ: "zo",
  だ: "da",
  ぢ: "ji",
  づ: "zu",
  で: "de",
  ど: "do",
  ば: "ba",
  び: "bi",
  ぶ: "bu",
  べ: "be",
  ぼ: "bo",
  ぱ: "pa",
  ぴ: "pi",
  ぷ: "pu",
  ぺ: "pe",
  ぽ: "po",
  ゔ: "vu",
  ぁ: "a",
  ぃ: "i",
  ぅ: "u",
  ぇ: "e",
  ぉ: "o",
};

const contractedVowels: Record<string, string> = { ゃ: "a", ゅ: "u", ょ: "o" };

// 拗音の子音部分（きゃ → ky + a）
const contractedHeads: Record<string, string> = {
  き: "ky",
  ぎ: "gy",
  し: "sh",
  じ: "j",
  ち: "ch",
  ぢ: "j",
  に: "ny",
  ひ: "hy",
  び: "by",
  ぴ: "py",
  み: "my",
  り: "ry",
};

// 漢字の接頭語。読みの先頭が一致したらハイフンで区切る（新大阪 → Shin-Osaka）
const namePrefixes: { kanji: string; reading: string }[] = [
  { kanji: "新", reading: "しん" },
  { kanji: "東", reading: "ひがし" },
  { kanji: "西", reading: "にし" },
  { kanji: "北", reading: "きた" },
  { kanji: "南", reading: "みなみ" },
  { kanji: "大阪", reading: "おおさか" },
  { kanji: "京都", reading: "きょうと" },
  { kanji: "神戸", reading: "こうべ" },
  { kanji: "近鉄", reading: "きんてつ" },
];

const jrReading = "じぇいあーる";

function splitSyllables(reading: string): string[] | null {
  const units: string[] = [];
  for (let i = 0; i < reading.length; i++) {
    const ch = reading[i] as string;
    const next = reading[i + 1];
    if (ch === "っ" || ch === "ん" || ch === "ー") {
      units.push(ch);
      continue;
    }
    if (next && contractedVowels[next] && contractedHeads[ch]) {
      units.push(ch + next);
      i++;
      continue;
    }
    if (!(ch in syllables)) return null;
    units.push(ch);
  }
  return units;
}

function convertUnit(unit: string): string {
  if (unit.length === 2) {
    const head = contractedHeads[unit[0] as string] ?? "";
    return head + (contractedVowels[unit[1] as string] ?? "");
  }
  return syllables[unit] ?? "";
}

// 長音（おう・おお・うう）を 1 文字に縮める
function shortenLongVowels(text: string): string {
  return text.replace(/ou/g, "o").replace(/oo/g, "o").replace(/uu/g, "u");
}

function romanizeKana(reading: string): string | null {
  const units = splitSyllables(reading);
  if (units === null) return null;
  const romans = units.map((u) => (u === "っ" || u === "ん" || u === "ー" ? u : convertUnit(u)));
  let out = "";
  for (let i = 0; i < romans.length; i++) {
    const r = romans[i] as string;
    const next = romans[i + 1] ?? "";
    if (r === "ー") continue;
    if (r === "っ") {
      out += next.startsWith("ch") ? "t" : next.charAt(0);
      continue;
    }
    if (r === "ん") {
      out += /^[bmp]/.test(next) ? "m" : "n";
      continue;
    }
    out += r;
  }
  return shortenLongVowels(out);
}

function capitalizeSegments(text: string): string {
  return text
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("-");
}

// 読みが無い、または変換できない文字を含むときは null
export function romanizeStationName(name: string, reading: string | undefined): string | null {
  if (!reading) return null;
  if (name.startsWith("JR") && reading.startsWith(jrReading)) {
    const rest = romanizeKana(reading.slice(jrReading.length));
    return rest ? `JR ${capitalizeSegments(rest)}` : null;
  }
  const prefix = namePrefixes.find(
    (p) =>
      name.length > p.kanji.length && name.startsWith(p.kanji) && reading.startsWith(p.reading),
  );
  if (prefix) {
    const head = romanizeKana(prefix.reading);
    const rest = romanizeKana(reading.slice(prefix.reading.length));
    return head && rest ? capitalizeSegments(`${head}-${rest}`) : null;
  }
  const whole = romanizeKana(reading);
  return whole ? capitalizeSegments(whole) : null;
}

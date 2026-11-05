import type { Knowledge } from "@repo/schema";

// 知見の例文と観測の文章を照合する。決定論モードの解釈に使う

const TIME_PATTERN = /\d{1,2}時\d{1,2}分|\d{1,2}:\d{2}|\d{1,2}時/g;
const TIME_PLACEHOLDER = "＃";
const PUNCTUATION_PATTERN = /[\s、。，．,.・!！?？「」『』（）()：:〜～\-－]/g;
const FRAGMENT_SPLIT_PATTERN = /[、。，．,.!！?？]/;

// 照合に使う断片の最短の長さ（文字）
const MIN_FRAGMENT_LENGTH = 4;
// 表記ゆれを許して照合する断片の最短の長さと、2 文字組の一致率のしきい値
// 窓の幅は断片の長さのこの倍率。離れた位置の文字の一致を拾わないようにする
const MIN_FUZZY_FRAGMENT_LENGTH = 8;
const FUZZY_THRESHOLD = 0.9;
const FUZZY_WINDOW_RATIO = 1.5;

export type SignalMatch = {
  eventType: string;
  signalId: string;
  fragment: string;
};

// 全角半角をそろえ、時刻を記号に置き換え、句読点と空白を除く
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(TIME_PATTERN, TIME_PLACEHOLDER)
    .replace(PUNCTUATION_PATTERN, "");
}

function splitFragments(phrase: string): string[] {
  return phrase
    .normalize("NFKC")
    .split(FRAGMENT_SPLIT_PATTERN)
    .map(normalizeForMatch)
    .filter((f) => f.length >= MIN_FRAGMENT_LENGTH);
}

function collectBigrams(text: string): string[] {
  const grams: string[] = [];
  for (let i = 0; i + 1 < text.length; i++) grams.push(text.slice(i, i + 2));
  return grams;
}

// 断片の 2 文字組のうち、文章の同じ窓に含まれる割合の最大値
function computeWindowedContainment(fragment: string, text: string): number {
  const grams = collectBigrams(fragment);
  if (grams.length === 0) return 0;
  const width = Math.ceil(fragment.length * FUZZY_WINDOW_RATIO);
  let best = 0;
  for (let start = 0; start === 0 || start + width <= text.length; start++) {
    const windowGrams = new Set(collectBigrams(text.slice(start, start + width)));
    best = Math.max(best, grams.filter((g) => windowGrams.has(g)).length / grams.length);
  }
  return best;
}

export type SignalFragmentIndex = {
  eventType: string;
  // 知見の中で 1 つの兆候にだけ現れる断片
  fragments: { signalId: string; fragment: string }[];
  identification: string[];
};

// 知見ごとに、兆候を見分けられる断片の索引を作る
export function buildFragmentIndex(knowledge: Knowledge): SignalFragmentIndex {
  const owners = new Map<string, Set<string>>();
  for (const phase of knowledge.phases) {
    for (const signal of phase.signals) {
      for (const phrase of signal.example_phrases) {
        for (const fragment of splitFragments(phrase)) {
          owners.set(fragment, (owners.get(fragment) ?? new Set()).add(signal.id));
        }
      }
    }
  }
  const fragments = [...owners]
    .filter(([, ids]) => ids.size === 1)
    .map(([fragment, ids]) => ({ signalId: [...ids][0] ?? "", fragment }));
  return {
    eventType: knowledge.id,
    fragments,
    identification: knowledge.identification.phrases
      .map(normalizeForMatch)
      .filter((p) => p.length > 0),
  };
}

// 文章に現れる兆候を返す。長い断片に含まれる短い断片の一致は捨てる
export function matchSignals(index: SignalFragmentIndex, text: string): SignalMatch[] {
  const normalized = normalizeForMatch(text);
  const spans: { start: number; end: number; signalId: string; fragment: string }[] = [];
  for (const { signalId, fragment } of index.fragments) {
    for (
      let at = normalized.indexOf(fragment);
      at >= 0;
      at = normalized.indexOf(fragment, at + 1)
    ) {
      spans.push({ start: at, end: at + fragment.length, signalId, fragment });
    }
  }
  const kept = spans.filter(
    (s) =>
      !spans.some(
        (o) =>
          o.signalId !== s.signalId &&
          o.end - o.start > s.end - s.start &&
          o.start <= s.start &&
          o.end >= s.end,
      ),
  );

  const matches = new Map<string, SignalMatch>();
  for (const s of kept) {
    if (!matches.has(s.signalId)) {
      matches.set(s.signalId, {
        eventType: index.eventType,
        signalId: s.signalId,
        fragment: s.fragment,
      });
    }
  }

  for (const { signalId, fragment } of index.fragments) {
    if (matches.has(signalId) || fragment.length < MIN_FUZZY_FRAGMENT_LENGTH) continue;
    if (computeWindowedContainment(fragment, normalized) >= FUZZY_THRESHOLD) {
      matches.set(signalId, { eventType: index.eventType, signalId, fragment });
    }
  }
  return [...matches.values()];
}

// 事象の見分け方の文言が文章に含まれるか
export function matchIdentification(index: SignalFragmentIndex, text: string): boolean {
  const normalized = normalizeForMatch(text);
  return index.identification.some((p) => normalized.includes(p));
}

// 断片を含む元の文を返す。見つからなければ文章全体
export function findQuote(text: string, fragment: string): string {
  const sentences = text
    .split(/(?<=[。．.!！?？])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const exact = sentences.find((s) => normalizeForMatch(s).includes(fragment));
  if (exact) return exact;
  const fragmentBigrams = collectBigrams(fragment);
  let best = text.trim();
  let bestScore = 0;
  for (const s of sentences) {
    const grams = new Set(collectBigrams(normalizeForMatch(s)));
    const score = fragmentBigrams.filter((g) => grams.has(g)).length;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

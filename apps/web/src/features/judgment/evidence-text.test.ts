import type { DetectedSignal, Estimate } from "@repo/schema";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";
import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import {
  buildEvidenceLines,
  evidenceLimit,
  listNextSignalPhrases,
  selectEvidenceEntries,
} from "./evidence-text";

const catalog: KnowledgeCatalog = [
  {
    id: "person_accident",
    name: { ja: "人身事故", en: "Person accident" },
    firstTrainWaitMinutes: 10,
    phases: [
      {
        id: "initial",
        name: { ja: "発生直後", en: "Just occurred" },
        signals: [
          { id: "pa_occurred", description: "知見の兆候の説明A", example_phrases: [] },
          { id: "pa_held", description: "知見の兆候の説明B", example_phrases: [] },
        ],
      },
      {
        id: "on_site",
        name: { ja: "現場の確認", en: "On-site check" },
        signals: [
          {
            id: "police_on_scene",
            description: "知見の兆候の説明C",
            example_phrases: ["警察が到着しました", "現場を確認しています"],
          },
          {
            id: "rescue_done",
            description: "知見の兆候の説明F",
            example_phrases: ["救護が終わりました"],
          },
          { id: "no_phrase", description: "知見の兆候の説明G", example_phrases: [] },
        ],
      },
      {
        id: "resume_estimate",
        name: { ja: "再開見込みの発表", en: "Restart time announced" },
        signals: [
          { id: "estimate_announced", description: "知見の兆候の説明D", example_phrases: [] },
        ],
      },
      {
        id: "preparing",
        name: { ja: "再開の準備", en: "Preparing to restart" },
        signals: [
          { id: "preparing_announced", description: "知見の兆候の説明E", example_phrases: [] },
        ],
      },
    ],
  },
];

const signal = (signalId: string, quote: string): DetectedSignal => ({
  eventType: "person_accident",
  signalId,
  quote,
});

const signals: DetectedSignal[] = [
  signal("pa_occurred", "人身事故のため、運転を見合わせています。"),
  signal("pa_held", "列車は駅で止まっています。"),
  signal("police_on_scene", "警察による現場の確認を行っています。"),
  signal("estimate_announced", "再開は22時ごろの見込みです。"),
  signal("preparing_announced", "運転再開の準備をしています。"),
];

const estimate = (phaseId: string | null, eventType: string | null = "person_accident") =>
  ({
    eventType,
    phaseId,
    elapsedMinutes: 10,
    remaining: { p50: 30, p80: 60 },
    confidence: "medium",
  }) as Estimate;

const translators = {
  ja: createTranslator({ locale: "ja", messages: ja, namespace: "judgment.evidence" }),
  en: createTranslator({ locale: "en", messages: en, namespace: "judgment.evidence" }),
};

function renderLines(locale: "ja" | "en", entries: ReturnType<typeof selectEvidenceEntries>) {
  const t = translators[locale];
  return buildEvidenceLines(entries, (key, values) => t(key as never, values as never));
}

// 画面に出る文。id、英字の札、知見の本文、決まった流れの言い方が入らないことを確かめる
function collectShownTexts(locale: "ja" | "en", phaseId: string | null): string[] {
  const entries = selectEvidenceEntries({ catalog, estimate: estimate(phaseId), signals, locale });
  const t = translators[locale];
  return [
    t("title"),
    t("heard"),
    t("reading.label"),
    ...renderLines(locale, entries).flatMap((line) => [line.heard, line.reading]),
  ];
}

describe("selectEvidenceEntries", () => {
  it("項目は最大 3 つで、いまの段階の言葉を先に、新しい言葉を先に並べる", () => {
    const entries = selectEvidenceEntries({
      catalog,
      estimate: estimate("resume_estimate"),
      signals,
      locale: "ja",
    });
    expect(entries).toHaveLength(evidenceLimit);
    expect(entries.map((e) => e.id)).toEqual([
      "estimate_announced",
      "preparing_announced",
      "police_on_scene",
    ]);
    expect(entries.map((e) => e.current)).toEqual([true, false, false]);
  });

  it("同じ段階の言葉は新しい引用 1 つにまとめ、同じ引用も 1 つにまとめる", () => {
    const sameStage = selectEvidenceEntries({
      catalog,
      estimate: estimate("initial"),
      signals: signals.slice(0, 2),
      locale: "ja",
    });
    expect(sameStage.map((e) => e.id)).toEqual(["pa_held"]);
    expect(sameStage[0]?.phaseName).toBe("発生直後");
    expect(sameStage[0]?.current).toBe(true);

    // 前の段階の言葉も、段階ごとに 1 つにする
    const earlier = selectEvidenceEntries({
      catalog,
      estimate: estimate("on_site"),
      signals: signals.slice(0, 3),
      locale: "ja",
    });
    expect(earlier.map((e) => e.phaseId)).toEqual(["on_site", "initial"]);
    expect(new Set(earlier.map((e) => e.phaseId)).size).toBe(earlier.length);

    // 段階の分からない言葉も 1 つにまとめる
    const unknown = selectEvidenceEntries({
      catalog,
      estimate: estimate(null),
      signals: [
        signal("other_a", "列車が止まりました。"),
        signal("other_b", "しばらくお待ちください。"),
      ],
      locale: "ja",
    });
    expect(unknown.map((e) => e.id)).toEqual(["other_b"]);

    const sameQuote = selectEvidenceEntries({
      catalog,
      estimate: estimate("initial"),
      signals: [
        signal("pa_occurred", "列車は駅で止まっています。"),
        signal("pa_held", "列車は駅で止まっています。"),
      ],
      locale: "ja",
    });
    expect(sameQuote.map((e) => e.id)).toEqual(["pa_held"]);
  });

  it("いまの段階の言葉が無ければ、最も新しい言葉からいまの段階を読む", () => {
    const entries = selectEvidenceEntries({
      catalog,
      estimate: estimate("on_site"),
      signals: signals.slice(0, 1),
      locale: "ja",
    });
    expect(entries).toEqual([
      {
        id: "pa_occurred",
        heard: "人身事故のため、運転を見合わせています。",
        phaseId: "on_site",
        phaseName: "現場の確認",
        current: true,
      },
    ]);
  });

  it("引用が無く原因だけを選んだときは、選んだ原因を聞いたことにする", () => {
    const entries = selectEvidenceEntries({
      catalog,
      estimate: estimate("initial"),
      signals: [],
      locale: "ja",
      heardCause: "人身事故",
    });
    expect(entries).toEqual([
      {
        id: "person_accident",
        heard: "人身事故",
        phaseId: "initial",
        phaseName: "発生直後",
        current: true,
      },
    ]);
  });

  it("事象も引用も無ければ項目を出さない", () => {
    expect(
      selectEvidenceEntries({ catalog, estimate: estimate(null, null), signals: [], locale: "ja" }),
    ).toEqual([]);
  });

  it("長い引用は最初の 1 文だけにする", () => {
    const entries = selectEvidenceEntries({
      catalog,
      estimate: estimate("on_site"),
      signals: [signal("police_on_scene", "現場の確認を行っています。しばらくお待ちください。")],
      locale: "ja",
    });
    expect(entries[0]?.heard).toBe("現場の確認を行っています。");
  });
});

describe("buildEvidenceLines", () => {
  it("日本語は「聞いたこと」の引用と「いまは◯◯の段階です。」の 2 行にする", () => {
    const entries = selectEvidenceEntries({
      catalog,
      estimate: estimate("on_site"),
      signals: signals.slice(0, 3),
      locale: "ja",
    });
    expect(renderLines("ja", entries)).toEqual([
      {
        id: "police_on_scene",
        phaseId: "on_site",
        current: true,
        heard: "「警察による現場の確認を行っています。」",
        reading: "いまは現場の確認の段階です。",
      },
      {
        id: "pa_held",
        phaseId: "initial",
        current: false,
        heard: "「列車は駅で止まっています。」",
        reading: "発生直後の段階に入ったと読めます。",
      },
    ]);
  });

  it("英語は同じ中身を英語で出す", () => {
    const entries = selectEvidenceEntries({
      catalog,
      estimate: estimate("on_site"),
      signals: signals.slice(2, 3),
      locale: "en",
    });
    expect(renderLines("en", entries)).toEqual([
      {
        id: "police_on_scene",
        phaseId: "on_site",
        current: true,
        heard: "“警察による現場の確認を行っています。”",
        reading: "Service is now at the “On-site check” stage.",
      },
    ]);
  });

  it("日本語の文に英語の id と英字が入らず、決まった流れと再開の時間の言い切りも出ない", () => {
    const ids = [
      ...catalog.flatMap((e) => [
        e.id,
        ...e.phases.flatMap((p) => [p.id, ...p.signals.map((s) => s.id)]),
      ]),
    ];
    for (const phaseId of ["initial", "on_site", "resume_estimate", "preparing", null]) {
      for (const text of collectShownTexts("ja", phaseId)) {
        expect(text, text).not.toMatch(/[A-Za-z_]/);
        for (const id of ids) expect(text).not.toContain(id);
        expect(text).not.toMatch(
          /よくある流れ|ふつう|[0-9０-９一二三四五六七八九十]+(時間|分)ほど/,
        );
        expect(text).not.toMatch(/知見の兆候の説明/);
      }
    }
  });

  it("英語の文にも id と決まった流れの言い方が入らない", () => {
    const ids = catalog.flatMap((e) => [e.id, ...e.phases.map((p) => p.id)]);
    for (const text of collectShownTexts("en", "on_site")) {
      for (const id of ids) expect(text).not.toContain(id);
      expect(text).not.toMatch(/typical flow|usually/i);
    }
  });

  it("段階が分からないときは、まだ絞れていないと書く", () => {
    const [line] = renderLines("ja", [
      { id: "x", heard: "人身事故", phaseId: null, phaseName: null, current: false },
    ]);
    expect(line?.reading).toBe("段階はまだ絞れていません。");
  });
});

describe("listNextSignalPhrases", () => {
  it("次の段階の兆候を、放送の言い回しの例で返す", () => {
    const phrases = listNextSignalPhrases(catalog, estimate("initial"), "ja");
    expect(phrases).toEqual(["警察が到着しました", "救護が終わりました"]);
    for (const phrase of phrases) expect(phrase).not.toMatch(/知見の兆候の説明/);
  });

  it("最後の段階、英語の画面、事象の分からないときは空にする", () => {
    expect(listNextSignalPhrases(catalog, estimate("preparing"), "ja")).toEqual([]);
    expect(listNextSignalPhrases(catalog, estimate("initial"), "en")).toEqual([]);
    expect(listNextSignalPhrases(catalog, estimate(null, null), "ja")).toEqual([]);
    expect(listNextSignalPhrases(catalog, null, "ja")).toEqual([]);
  });

  it("根拠の欄の 1 行は放送の言い回しを引き、再開が近づくと言う", () => {
    const [phrase] = listNextSignalPhrases(catalog, estimate("initial"), "ja");
    const line = translators.ja("next", { phrase: phrase ?? "" });
    expect(line).toBe("「警察が到着しました」と聞こえたら、再開が近づきます。");
    expect(line).not.toMatch(/[0-9０-９]+(時間|分)ほど/);
  });
});

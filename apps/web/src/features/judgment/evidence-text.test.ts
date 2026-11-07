import type { DetectedSignal, Estimate } from "@repo/schema";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import {
  buildEvidenceLines,
  cueIds,
  evidenceLimit,
  selectCueReading,
  selectEvidenceEntries,
} from "./evidence-text";

const signal = (signalId: string, quote: string): DetectedSignal => ({
  eventType: "person_collision",
  signalId,
  quote,
});

const signals: DetectedSignal[] = [
  signal("occurred", "人身事故のため、運転を見合わせています。"),
  signal("held", "列車は駅で止まっています。"),
  signal("rescue", "ただいま救護活動を行っています。"),
  signal("resume_soon", "まもなく運転を再開します。"),
];

const estimate = (phaseId: string | null, eventType: string | null = "person_collision") =>
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

function listMessageTexts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return value && typeof value === "object" ? Object.values(value).flatMap(listMessageTexts) : [];
}

describe("selectCueReading", () => {
  it("手がかりの id を優先の順に 1 つ選ぶ", () => {
    expect(selectCueReading(["rescue", "resume_soon"])).toBe("resume_soon");
    expect(selectCueReading(["occurred", "protection_received"])).toBe("protection_received");
    expect(selectCueReading(["resumed", "queue_ahead"])).toBe("resumed");
  });

  it("手がかりが無ければ null", () => {
    expect(selectCueReading([])).toBeNull();
    expect(selectCueReading(["occurred", "held"])).toBeNull();
  });
});

describe("selectEvidenceEntries", () => {
  it("項目は最大 3 つで、新しい言葉を先に並べる", () => {
    const entries = selectEvidenceEntries({ estimate: estimate("on_site"), signals });
    expect(entries).toHaveLength(evidenceLimit);
    expect(entries.map((e) => e.id)).toEqual(["resume_soon", "rescue", "held"]);
  });

  it("読みは最も優先する手がかりを含む項目 1 つにだけ付ける", () => {
    const entries = selectEvidenceEntries({ estimate: estimate(null), signals });
    expect(entries.map((e) => e.cueId)).toEqual(["resume_soon", null, null]);
  });

  it("同じ引用は 1 項目にまとめ、兆候の id はすべて残す", () => {
    const quote = "まもなく運転を再開します。";
    const entries = selectEvidenceEntries({
      estimate: estimate(null),
      signals: [signal("held", quote), signal("resume_soon", quote)],
    });
    expect(entries).toEqual([
      { id: "resume_soon", heard: quote, signalIds: ["resume_soon", "held"], cueId: "resume_soon" },
    ]);
  });

  it("引用は最初の 1 文だけにする", () => {
    const [entry] = selectEvidenceEntries({
      estimate: estimate(null),
      signals: [signal("rescue", "救護活動を行っています。再開は未定です。")],
    });
    expect(entry?.heard).toBe("救護活動を行っています。");
  });

  it("推定と違う事象の言葉は使わない", () => {
    const entries = selectEvidenceEntries({
      estimate: estimate(null, "heavy_rain"),
      signals,
    });
    expect(entries).toEqual([]);
  });

  it("引用が無ければ、入口で選んだ原因を聞いた言葉にする。原因も無ければ空", () => {
    expect(
      selectEvidenceEntries({ estimate: estimate(null), signals: [], heardCause: "人身事故" }),
    ).toEqual([{ id: "cause", heard: "人身事故", signalIds: [], cueId: null }]);
    expect(selectEvidenceEntries({ estimate: null, signals: [] })).toEqual([]);
  });
});

describe("buildEvidenceLines", () => {
  it("手がかりがある項目だけに、行動を変える読みを 1 行付ける", () => {
    const lines = renderLines(
      "ja",
      selectEvidenceEntries({ estimate: estimate("on_site"), signals }),
    );
    expect(lines.map((l) => l.reading)).toEqual(["再開が近いと読めます。", null, null]);
    expect(lines[0]?.heard).toBe("「まもなく運転を再開します。」");
  });

  it("すべての手がかりに日本語と英語の読みがある", () => {
    for (const id of cueIds) {
      for (const locale of ["ja", "en"] as const) {
        const [line] = renderLines(locale, [{ id, heard: "x", cueId: id }]);
        expect(line?.reading, `${locale} ${id}`).toBeTruthy();
        expect(line?.reading).not.toContain("cue.");
        if (locale === "ja") expect(line?.reading).not.toMatch(/[A-Za-z_]/);
      }
    }
  });

  it("事象の段階の名前と「いまは◯◯の段階です」を出さない", () => {
    const phaseIds = ["initial", "on_site", "rescue", "resume_estimate", "preparing", null];
    for (const locale of ["ja", "en"] as const) {
      for (const phaseId of phaseIds) {
        const entries = selectEvidenceEntries({ estimate: estimate(phaseId), signals });
        const t = translators[locale];
        const texts = [
          t("title"),
          t("heard"),
          t("reading.label"),
          ...renderLines(locale, entries).flatMap((l) => [l.heard, l.reading ?? ""]),
        ];
        for (const text of texts) {
          expect(text).not.toMatch(/段階|stage|phase/i);
          if (phaseId) expect(text).not.toContain(phaseId);
        }
      }
    }
    // 判断の画面の訳の文にも段階の言い方が残らない。鍵の名前は見ない
    expect(listMessageTexts(ja.judgment).filter((s) => /段階/.test(s))).toEqual([]);
    expect(listMessageTexts(en.judgment).filter((s) => /\b(stage|phase)\b/i.test(s))).toEqual([]);
  });
});

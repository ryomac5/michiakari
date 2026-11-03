import type { RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { headlineLimits, reasonLimits } from "../src/config.ts";
import { checkDecisiveWording } from "../src/judge/assemble.ts";
import {
  buildBreakEvenSentence,
  buildDecisionText,
  buildPassedSentence,
  buildWeatherSummary,
  type DecisionReason,
  formatLabelInSentence,
} from "../src/judge/templates.ts";

// 決定論モードの見出しが短く、理由が見出しと分かれ、比較の形で書かれることを確かめる

const REASONS: DecisionReason[] = [
  "unknown_event",
  "no_alternative",
  "break_even_passed",
  "rain_continuing",
  "low_confidence",
  "estimate_extended",
  "resume_after_break_even",
  "deadline_risk",
  "resume_before_break_even",
];

const LONG_LABEL = "神戸電鉄三田線経由で振替輸送を使う長い経路名";

// 分岐点 23:23、再開見込み p50 23:40・p80 23:55、期限 23:50
const OUTLOOK = {
  breakEvenTime: "2026-11-05T23:23:00+09:00",
  resumeP50: "2026-11-05T23:40:00+09:00",
  resumeP80: "2026-11-05T23:55:00+09:00",
  marginP50Minutes: -17,
  deadline: "2026-11-05T23:50:00+09:00",
};

const NO_OUTLOOK = {
  breakEvenTime: null,
  resumeP50: null,
  resumeP80: null,
  marginP50Minutes: null,
  deadline: null,
};

const OPTIONS: Pick<RouteOption, "kind" | "label" | "isTransferService">[] = [
  { kind: "transfer", label: LONG_LABEL, isTransferService: true },
  { kind: "transfer", label: LONG_LABEL, isTransferService: false },
  { kind: "taxi", label: "タクシー", isTransferService: false },
  { kind: "walk", label: "徒歩", isTransferService: false },
];

describe("buildDecisionText", () => {
  for (const language of ["ja", "en"] as const) {
    it(`${language} の見出しと理由は目安の長さに収まり、見出しは経路名を含まない`, () => {
      for (const reason of REASONS) {
        for (const bestOption of OPTIONS) {
          for (const outlook of [OUTLOOK, NO_OUTLOOK]) {
            const text = buildDecisionText({
              reason,
              language,
              breakEvenMinutesFromNow: 120,
              bestOption,
              ...outlook,
            });
            expect([...text.headline].length).toBeLessThanOrEqual(headlineLimits[language].target);
            // 時刻を出すのは、待ちつつ分岐点を過ぎたら切り替える形の見出しだけ
            if (/\d{1,2}(時\d{2}分|:\d{2})/.test(text.headline)) {
              expect(["unknown_event", "low_confidence"]).toContain(reason);
            }
            expect(text.headline).not.toContain(LONG_LABEL);
            expect(checkDecisiveWording("headline", text.headline, language)).toEqual([]);
            expect(checkDecisiveWording("reason", text.reason, language)).toEqual([]);
            expect(text.reason.length).toBeGreaterThan(0);
            expect([...text.reason].length).toBeLessThanOrEqual(reasonLimits[language].target);
            expect(text.reason).not.toContain(LONG_LABEL);
          }
        }
      }
    });
  }

  it("保留の見出しは、分岐点まで待ち動かなければ切り替える形にする", () => {
    const input = {
      reason: "unknown_event" as const,
      breakEvenMinutesFromNow: 23,
      bestOption: { kind: "transfer" as const, label: "四つ橋線経由", isTransferService: false },
      ...OUTLOOK,
    };
    const ja = buildDecisionText({ ...input, language: "ja" });
    expect(ja.headline).toBe("23時23分まで待って、だめなら切り替え");
    expect(ja.reason).toBe(
      "23時23分を過ぎると別の路線のほうが早く着きます。放送で原因が分かれば、もっと確かに言えます。",
    );
    expect(buildDecisionText({ ...input, language: "en" }).headline).toBe(
      "Wait until 23:23, then switch if still stopped.",
    );
    // 分岐点が無ければ待つ形にする
    expect(buildDecisionText({ ...input, ...NO_OUTLOOK, language: "ja" }).headline).toBe(
      "運転再開を待ってください",
    );
  });

  it("待つときの見出しは分岐点までの分を示す", () => {
    const input = {
      reason: "resume_before_break_even" as const,
      breakEvenMinutesFromNow: 25,
      bestOption: null,
      ...NO_OUTLOOK,
    };
    expect(buildDecisionText({ ...input, language: "ja" }).headline).toBe("あと25分は待てます");
    expect(buildDecisionText({ ...input, language: "en" }).headline).toBe(
      "You can wait 25 more minutes.",
    );
  });

  it("切り替えの見出しは手段の種類で呼び、理由は見出しと分ける", () => {
    const text = buildDecisionText({
      reason: "estimate_extended",
      language: "ja",
      breakEvenMinutesFromNow: 38,
      bestOption: { kind: "transfer", label: "阪急京都線で振替", isTransferService: true },
      ...OUTLOOK,
    });
    expect(text.headline).toBe("いま振替に切り替えてください");
    expect(text.reason).toContain("延長");
  });

  it("理由は再開見込みと分岐点を比べる形で書く", () => {
    const input = {
      reason: "resume_after_break_even" as const,
      breakEvenMinutesFromNow: 13,
      bestOption: { kind: "transfer" as const, label: "阪急京都線で振替", isTransferService: true },
      ...OUTLOOK,
    };
    expect(buildDecisionText({ ...input, language: "ja" }).reason).toBe(
      "再開見込み23時40分頃が、分岐点23時23分より遅いためです。",
    );
    expect(buildDecisionText({ ...input, language: "en" }).reason).toBe(
      "Resumption is expected around 23:40, later than the break-even time of 23:23.",
    );
  });

  it("待つときの理由は、見込みが分岐点より早いか、差が小さいかで書き分ける", () => {
    const base = {
      reason: "resume_before_break_even" as const,
      language: "ja" as const,
      breakEvenMinutesFromNow: 30,
      bestOption: null,
      ...OUTLOOK,
    };
    expect(buildDecisionText({ ...base, marginP50Minutes: 10 }).reason).toContain("より早い");
    expect(buildDecisionText({ ...base, marginP50Minutes: -3 }).reason).toContain("差が小さく");
  });

  it("期限で切り替えるときは、期限の時刻と切り替え先を比べる", () => {
    const text = buildDecisionText({
      reason: "deadline_risk",
      language: "ja",
      breakEvenMinutesFromNow: 30,
      bestOption: { kind: "taxi", label: "タクシー", isTransferService: false },
      ...OUTLOOK,
    });
    expect(text.reason).toBe("待つと期限の23時50分に間に合わず、タクシーなら間に合うためです。");
  });
});

describe("分岐点の説明文", () => {
  const time = "2026-11-05T22:44:00+09:00";

  it("英語では、文頭用の経路ラベルを文の途中に合う小文字の名詞句にする", () => {
    expect(buildBreakEvenSentence(time, "Via Hankyu Kyoto Line", "en")).toBe(
      "If service has not resumed by 22:44, the route via Hankyu Kyoto Line gets you there sooner.",
    );
    expect(buildPassedSentence(time, "Transfer service via Hankyu Kobe Line", "en")).toBe(
      "The break-even time of 22:44 has passed. Even if service resumed now, the transfer service via Hankyu Kobe Line would be faster.",
    );
  });

  it("タクシーと徒歩は冠詞や動名詞で文に収める", () => {
    expect(buildBreakEvenSentence(time, "Taxi", "en")).toBe(
      "If service has not resumed by 22:44, a taxi gets you there sooner.",
    );
    expect(formatLabelInSentence("Walk", "en")).toBe("walking");
  });

  it("定型でない英語のラベルと、日本語のラベルはそのまま使う", () => {
    expect(formatLabelInSentence("Hankyu Kyoto Line", "en")).toBe("Hankyu Kyoto Line");
    expect(formatLabelInSentence("Via", "en")).toBe("Via");
    expect(buildBreakEvenSentence(time, "阪急京都線経由", "ja")).toBe(
      "22時44分までに再開しなければ、阪急京都線経由のほうが早く着きます。",
    );
  });

  it("英語の説明文は、文頭以外に大文字の Via や Transfer を含まない", () => {
    for (const label of ["Via Hankyu Kyoto Line", "Transfer service via JR Kobe Line"]) {
      for (const sentence of [
        buildBreakEvenSentence(time, label, "en"),
        buildPassedSentence(time, label, "en"),
      ]) {
        expect(sentence).not.toMatch(/.\b(Via|Transfer service)\b/);
      }
    }
  });
});

describe("weather_checked の要約", () => {
  it("日本語は雨量・傾向・警報を一続きで書く", () => {
    const text = buildWeatherSummary({
      latestMm: 5,
      trend: "falling",
      warnings: ["大雨警報"],
      language: "ja",
    });
    expect(text).toBe("直近の10分雨量は5mmで、弱まっています。大雨警報が出ています。");
  });

  it("傾向が分からなければ傾向を書かず、英語では警報名を訳さずに伝える", () => {
    expect(
      buildWeatherSummary({ latestMm: 2, trend: "unknown", warnings: [], language: "ja" }),
    ).toBe("直近の10分雨量は2mmです。");
    const en = buildWeatherSummary({
      latestMm: 2,
      trend: "rising",
      warnings: ["大雨警報"],
      language: "en",
    });
    expect(en).toBe("Latest 10-min rainfall: 2 mm, increasing. A weather warning is in effect.");
    expect(/[ぁ-んァ-ヶ一-龥]/.test(en)).toBe(false);
  });
});

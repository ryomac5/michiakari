import type { RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { headlineLimits, reasonLimits } from "../src/config.ts";
import { checkDecisiveWording } from "../src/judge/assemble.ts";
import {
  buildBreakEvenSentence,
  buildDeadlineBreakEvenSentence,
  buildDeadlinePassedSentence,
  buildDecisionText,
  buildNoAlternativeSentence,
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
            const sentences = text.reason.split(language === "ja" ? /(?<=。)/ : /(?<=[.!?])\s+/);
            for (const sentence of sentences) {
              expect([...sentence].length).toBeLessThanOrEqual(language === "ja" ? 50 : 100);
            }
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
    expect(ja.headline).toBe("23時23分までに動かなければ切り替える");
    expect(ja.reason).toBe("23時23分を過ぎると別の路線のほうが早く着きます。");
    expect(buildDecisionText({ ...input, language: "en" }).headline).toBe(
      "Wait until 23:23. Switch if still stopped.",
    );
    // 分岐点が無ければ待つ形にする
    expect(buildDecisionText({ ...input, ...NO_OUTLOOK, language: "ja" }).headline).toBe(
      "運転再開を待つ",
    );
  });

  for (const reason of ["unknown_event", "low_confidence"] as const) {
    for (const language of ["ja", "en"] as const) {
      it(`${reason}・${language} は分岐点なしで待つ理由を示し、次の確認を重ねない`, () => {
        const text = buildDecisionText({
          reason,
          language,
          breakEvenMinutesFromNow: null,
          bestOption: null,
          ...NO_OUTLOOK,
        });
        expect(text.headline).toBe(
          language === "ja" ? "運転再開を待つ" : "Wait for service to resume.",
        );
        expect(text.reason).toBe(
          language === "ja"
            ? "待つ場合と比べられる代わりの経路がないため運転再開を待ちます。"
            : "Wait for service to resume because there is no alternative route to compare.",
        );
        expect(text.reason).not.toMatch(/確かめる|Listen for/);
      });
    }
  }

  it("待つときの見出しは分岐点までの分を示す", () => {
    const input = {
      reason: "resume_before_break_even" as const,
      breakEvenMinutesFromNow: 25,
      bestOption: null,
      ...NO_OUTLOOK,
    };
    expect(buildDecisionText({ ...input, language: "ja" }).headline).toBe("あと25分は待つ");
    expect(buildDecisionText({ ...input, language: "en" }).headline).toBe(
      "Wait up to 25 more minutes.",
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
    expect(text.headline).toBe("いま振替に切り替える");
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
      "再開見込み23時40分頃は分岐点23時23分より後です。",
    );
    expect(buildDecisionText({ ...input, language: "en" }).reason).toBe(
      "Expected restart 23:40 is after the decision point of 23:23.",
    );
  });

  it("流れと確率を添えても再開見込みと分岐点を残し90字以内に収める", () => {
    const input = {
      reason: "resume_after_break_even" as const,
      language: "ja" as const,
      breakEvenMinutesFromNow: 13,
      bestOption: null,
      ...OUTLOOK,
      flow: {
        outlook: "long" as const,
        sentence: "人身事故は、再開まで1時間ほどかかるのがふつうです。",
        inReason: true,
      },
      chance: {
        waitFaster: 0,
        comparisonTime: OUTLOOK.breakEvenTime,
        waitOnTime: null,
        keyTick: null,
      },
    };
    const comparison = "再開見込み23時40分頃は分岐点23時23分より後です。";
    const chance = "分岐点の23時23分までに再開する見込みは1割未満です。";
    const text = buildDecisionText(input);
    expect(text.reason).toBe(`${input.flow.sentence}${comparison}${chance}`);
    expect([...text.reason].length).toBeLessThanOrEqual(90);

    const longerFlow = buildDecisionText({
      ...input,
      flow: {
        ...input.flow,
        sentence:
          "人身事故は、関係機関による確認が終わるまで再開を待つため1時間ほどかかるのがふつうです。",
      },
    });
    expect(longerFlow.reason).toBe(`${comparison}${chance}`);
    expect([...longerFlow.reason].length).toBeLessThanOrEqual(90);
  });

  it("待つときの理由は、見込みが分岐点より前か、差が小さいかで書き分ける", () => {
    const base = {
      reason: "resume_before_break_even" as const,
      language: "ja" as const,
      breakEvenMinutesFromNow: 30,
      bestOption: null,
      ...OUTLOOK,
    };
    expect(buildDecisionText({ ...base, marginP50Minutes: 10 }).reason).toContain("より前");
    expect(buildDecisionText({ ...base, marginP50Minutes: -3 }).reason).toContain("差はわずか");
  });

  it("期限で切り替えるときは、期限の時刻と切り替え先を比べる", () => {
    const text = buildDecisionText({
      reason: "deadline_risk",
      language: "ja",
      breakEvenMinutesFromNow: 30,
      bestOption: { kind: "taxi", label: "タクシー", isTransferService: false },
      ...OUTLOOK,
    });
    expect(text.reason).toBe("待つと期限の23時50分に間に合いません。タクシーなら間に合います。");
  });
});

describe("分岐点の説明文", () => {
  const time = "2026-11-05T22:44:00+09:00";
  const arrival = "2026-11-05T23:30:00+09:00";

  it("日本語の説明は括弧や読点を使わず一文に収める", () => {
    const sentences = [
      buildBreakEvenSentence(time, "阪急京都線", arrival, "ja"),
      buildPassedSentence(time, "阪急京都線", arrival, "ja"),
      buildDeadlineBreakEvenSentence(time, arrival, "タクシー", arrival, "ja"),
      buildDeadlinePassedSentence(time, arrival, "タクシー", arrival, "ja"),
      buildNoAlternativeSentence("ja"),
    ];
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/[、（）()]/);
      expect(sentence.match(/。/g)).toHaveLength(1);
      expect([...sentence].length).toBeGreaterThanOrEqual(40);
      expect([...sentence].length).toBeLessThanOrEqual(50);
    }
  });

  it("英語では、文頭用の経路ラベルを文の途中に合う小文字の名詞句にする", () => {
    expect(buildBreakEvenSentence(time, "Via Hankyu Kyoto Line", arrival, "en")).toBe(
      "Resuming by 22:44 makes waiting at least as fast as the route via Hankyu Kyoto Line arriving at 23:30.",
    );
    expect(buildPassedSentence(time, "Transfer service via Hankyu Kobe Line", arrival, "en")).toBe(
      "Resuming by 22:44 would have made waiting at least as fast as the transfer service via Hankyu Kobe Line arriving at 23:30.",
    );
  });

  it("タクシーと徒歩は冠詞や動名詞で文に収める", () => {
    expect(buildBreakEvenSentence(time, "Taxi", arrival, "en")).toBe(
      "Resuming by 22:44 makes waiting at least as fast as a taxi arriving at 23:30.",
    );
    expect(formatLabelInSentence("Walk", "en")).toBe("walking");
  });

  it("定型でない英語のラベルと、日本語のラベルはそのまま使う", () => {
    expect(formatLabelInSentence("Hankyu Kyoto Line", "en")).toBe("Hankyu Kyoto Line");
    expect(formatLabelInSentence("Via", "en")).toBe("Via");
    expect(buildBreakEvenSentence(time, "阪急京都線経由", arrival, "ja")).toBe(
      "22時44分までに再開すれば23時30分着の阪急京都線経由より待つほうが早く着きます。",
    );
  });

  it("過ぎた分岐点も再開の条件と比較先の到着を一文で示す", () => {
    expect(buildPassedSentence(time, "阪急京都線", arrival, "ja")).toBe(
      "22時44分までに再開すれば23時30分着の阪急京都線より待つほうが早い境目でした。",
    );
  });

  it("英語の説明文は、文頭以外に大文字の Via や Transfer を含まない", () => {
    for (const label of ["Via Hankyu Kyoto Line", "Transfer service via JR Kobe Line"]) {
      for (const sentence of [
        buildBreakEvenSentence(time, label, arrival, "en"),
        buildPassedSentence(time, label, arrival, "en"),
      ]) {
        expect(sentence).not.toMatch(/.\b(Via|Transfer service)\b/);
      }
    }
  });
});

describe("期限が理由でタクシーを勧めるときの文", () => {
  const time = "2026-11-06T08:10:00+09:00";
  const deadline = "2026-11-06T09:00:00+09:00";
  const arrival = "2026-11-06T08:55:00+09:00";

  it("期限から求めた分岐点はタクシーへ切り替えず間に合う条件を書く", () => {
    expect(buildDeadlineBreakEvenSentence(time, deadline, "タクシー", arrival, "ja")).toBe(
      "8時10分までに再開すれば8時55分着のタクシーに切り替えず期限に間に合います。",
    );
    expect(buildDeadlineBreakEvenSentence(time, deadline, "Taxi", arrival, "en")).toBe(
      "Resuming by 08:10 lets you meet your 09:00 deadline without switching to a taxi arriving at 08:55.",
    );
  });

  it("分岐点を過ぎたときは、いま再開しても期限に間に合わないと書く", () => {
    expect(buildDeadlinePassedSentence(time, deadline, "タクシー", arrival, "ja")).toBe(
      "8時10分を過ぎた今は9時00分の期限に向け8時55分着のタクシーに切り替える。",
    );
    expect(buildDeadlinePassedSentence(time, deadline, "Taxi", arrival, "en")).toBe(
      "After 08:10, switch to a taxi arriving at 08:55 to meet your 09:00 deadline.",
    );
  });

  it("理由は、タクシーのほうが早く着くではなく、待っては期限に間に合わないと書く", () => {
    const taxi = { kind: "taxi", label: "タクシー", isTransferService: false } as const;
    const base = {
      language: "ja",
      breakEvenMinutesFromNow: 45,
      breakEvenTime: time,
      resumeP50: "2026-11-06T08:06:00+09:00",
      resumeP80: "2026-11-06T09:37:00+09:00",
      marginP50Minutes: 16,
      deadline,
      deadlineBasis: deadline,
      bestOption: taxi,
    } as const;
    const hold = buildDecisionText({ ...base, reason: "low_confidence" });
    expect(hold.reason).toBe(
      "8時10分を過ぎると待っては期限の9時00分に間に合いません。再開見込みは8時06分〜9時37分頃です。",
    );
    const passed = buildDecisionText({ ...base, reason: "break_even_passed" });
    expect(passed.reason).toBe(
      "分岐点8時10分を過ぎています。いま再開しても期限の9時00分に間に合いません。",
    );
    for (const reason of ["unknown_event", "low_confidence", "break_even_passed"] as const) {
      expect(buildDecisionText({ ...base, reason }).reason).not.toContain("のほうが早く着きます");
    }
    // 期限が理由でなければ、これまでどおり代替手段のほうが早く着くと書く
    const plain = buildDecisionText({ ...base, deadlineBasis: null, reason: "low_confidence" });
    expect(plain.reason).toContain("タクシーのほうが早く着きます");
  });

  it("期限が理由の理由の文は、見出しと理由の上限に収まる", () => {
    const taxi = { kind: "taxi", label: "タクシー", isTransferService: false } as const;
    for (const language of ["ja", "en"] as const) {
      for (const reason of REASONS) {
        const text = buildDecisionText({
          reason,
          language,
          breakEvenMinutesFromNow: 45,
          breakEvenTime: time,
          resumeP50: "2026-11-06T08:06:00+09:00",
          resumeP80: "2026-11-06T09:37:00+09:00",
          marginP50Minutes: 16,
          deadline,
          deadlineBasis: deadline,
          bestOption: taxi,
        });
        expect([...text.reason].length).toBeLessThanOrEqual(reasonLimits[language].max);
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

import type { RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { headlineLimits, reasonLimits } from "../src/config.ts";
import { findFlowWording } from "../src/domain/flow-wording.ts";
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

// 大阪から大阪梅田まで歩いて阪急京都線に乗る経路の区間
const HANKYU_WALK = { mode: "walk" as const, from: "大阪", to: "大阪梅田", minutes: 9 };
const HANKYU_RIDE = {
  mode: "ride" as const,
  from: "大阪梅田",
  to: "京都河原町",
  minutes: 44,
  line: "阪急京都線",
};

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
            // 見出しの 1 文目が大きく出る行動。2 文目は動かなかったときの次の手
            const lead = text.headline.split(language === "ja" ? "。" : /(?<=\.)\s/)[0] ?? "";
            expect([...lead].length).toBeLessThanOrEqual(headlineLimits[language].target);
            expect([...text.headline].length).toBeLessThanOrEqual(headlineLimits[language].max);
            // 時刻を出すのは、境目の時刻まで待つ形の見出しだけ
            if (/\d{1,2}(時\d{2}分|:\d{2})/.test(text.headline)) {
              expect(["unknown_event", "low_confidence", "resume_before_break_even"]).toContain(
                reason,
              );
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

  it("経路の路線名が分からなくても「おすすめの経路」とは書かず、乗る駅か手段の種類で言い切る", () => {
    const base = {
      reason: "resume_after_break_even" as const,
      breakEvenMinutesFromNow: 13,
      ...OUTLOOK,
    };
    const nameless = { ...HANKYU_RIDE, line: undefined };
    const cases = [
      // 路線名の無い区間でも、乗る駅が分かれば駅の名前で言い切る
      {
        bestOption: {
          kind: "transfer" as const,
          label: LONG_LABEL,
          isTransferService: false,
          legs: [HANKYU_WALK, nameless],
        },
        ja: "大阪梅田まで歩いて乗り換える",
        en: "Walk to 大阪梅田 and change trains.",
        fallbackJa: "動かなければ大阪梅田へ",
      },
      {
        bestOption: {
          kind: "transfer" as const,
          label: LONG_LABEL,
          isTransferService: false,
          legs: [nameless],
        },
        ja: "大阪梅田で乗り換える",
        en: "Change trains at 大阪梅田.",
        fallbackJa: "動かなければ大阪梅田へ",
      },
      // 区間が無ければ、振替輸送か電車の乗り換えかの種類で言い切る
      {
        bestOption: { kind: "transfer" as const, label: LONG_LABEL, isTransferService: true },
        ja: "振替輸送で向かう",
        en: "Use the transfer service.",
        fallbackJa: "動かなければ振替輸送へ",
      },
      {
        bestOption: { kind: "transfer" as const, label: LONG_LABEL, isTransferService: false },
        ja: "電車を乗り換える",
        en: "Change trains.",
        fallbackJa: "動かなければ電車を乗り換える",
      },
      {
        bestOption: { kind: "taxi" as const, label: "タクシー", isTransferService: false },
        ja: "タクシーに乗る",
        en: "Take a taxi.",
        fallbackJa: "動かなければタクシーへ",
      },
      {
        bestOption: { kind: "walk" as const, label: "徒歩", isTransferService: false },
        ja: "歩いて向かう",
        en: "Walk there.",
        fallbackJa: "動かなければ歩いて向かう",
      },
    ];
    for (const { bestOption, ja, en, fallbackJa } of cases) {
      const switching = buildDecisionText({ ...base, bestOption, language: "ja" });
      expect(switching.headline).toBe(ja);
      expect(switching.reason).not.toContain("おすすめの経路");
      expect(buildDecisionText({ ...base, bestOption, language: "en" }).headline).toBe(en);
      const waiting = buildDecisionText({
        ...base,
        reason: "unknown_event",
        bestOption,
        language: "ja",
      });
      expect(waiting.headline).toBe(`23時23分まで待つ。${fallbackJa}`);
      expect(waiting.reason).not.toContain("おすすめの経路");
    }
    // 代わりの手段が分からないときも、手段で向かうと言い切る
    const none = buildDecisionText({ ...base, bestOption: null, language: "ja" });
    expect(none.headline).toBe("代わりの手段で向かう");
    expect(none.reason).not.toContain("おすすめの経路");
  });

  it("保留の見出しは、境目まで待ち動かなければ乗る路線を添える形にする", () => {
    const input = {
      reason: "unknown_event" as const,
      breakEvenMinutesFromNow: 23,
      bestOption: { kind: "transfer" as const, label: "四つ橋線経由", isTransferService: false },
      ...OUTLOOK,
    };
    const ja = buildDecisionText({ ...input, language: "ja" });
    // 路線も駅も分からなくても、代わりの手段の種類で何をすればよいか言い切る
    expect(ja.headline).toBe("23時23分まで待つ。動かなければ電車を乗り換える");
    expect(ja.headline).not.toContain("切り替える");
    expect(ja.headline).not.toContain("おすすめの経路");
    expect(ja.reason).toBe("23時23分を過ぎると乗り換えのほうが早く着きます。");
    expect(buildDecisionText({ ...input, language: "en" }).headline).toBe(
      "Wait until 23:23. If still stopped, change trains.",
    );
    // 乗る路線が分かれば、次の手にその路線を書く
    const withLegs = buildDecisionText({
      ...input,
      language: "ja",
      bestOption: { ...input.bestOption, legs: [HANKYU_WALK, HANKYU_RIDE] },
    });
    expect(withLegs.headline).toBe("23時23分まで待つ。動かなければ阪急京都線へ");
    expect(withLegs.reason).toBe("23時23分を過ぎると阪急京都線のほうが早く着きます。");
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
          language === "ja" ? "運転再開を待つ" : "Wait for service to restart.",
        );
        expect(text.reason).toBe(
          language === "ja" ? "代わりの手段がありません。" : "No alternative route is available.",
        );
        expect(text.reason).not.toMatch(/確かめる|Listen for/);
      });
    }
  }

  it("待つときの見出しは境目の時刻まで待つと言い、動かなければ乗る路線を添える", () => {
    const input = {
      reason: "resume_before_break_even" as const,
      breakEvenMinutesFromNow: 25,
      bestOption: {
        kind: "transfer" as const,
        label: "阪急京都線経由",
        isTransferService: false,
        legs: [HANKYU_WALK, HANKYU_RIDE],
      },
      ...OUTLOOK,
      marginP50Minutes: 10,
    };
    expect(buildDecisionText({ ...input, language: "ja" }).headline).toBe(
      "23時23分まで待つ。動かなければ阪急京都線へ",
    );
    expect(buildDecisionText({ ...input, language: "en" }).headline).toBe(
      "Wait until 23:23. If still stopped, take the 阪急京都線.",
    );
    // 境目が無ければ、時刻を出さずに待つ
    expect(buildDecisionText({ ...input, ...NO_OUTLOOK, language: "ja" }).headline).toBe(
      "運転再開を待つ",
    );
  });

  it("切り替えの見出しは、乗る路線と歩いて向かう駅を言い切る", () => {
    const base = {
      reason: "estimate_extended" as const,
      language: "ja" as const,
      breakEvenMinutesFromNow: 38,
      ...OUTLOOK,
    };
    const walkTo = buildDecisionText({
      ...base,
      bestOption: {
        kind: "transfer",
        label: "阪急京都線経由",
        isTransferService: false,
        legs: [HANKYU_WALK, HANKYU_RIDE],
      },
    });
    expect(walkTo.headline).toBe("大阪梅田まで歩いて阪急京都線へ");
    expect(walkTo.reason).toContain("延長");
    const sameStation = buildDecisionText({
      ...base,
      bestOption: {
        kind: "transfer",
        label: "阪急京都線経由",
        isTransferService: false,
        legs: [HANKYU_RIDE],
      },
    });
    expect(sameStation.headline).toBe("阪急京都線に乗り換える");
    const transfer = buildDecisionText({
      ...base,
      bestOption: { kind: "transfer", label: "阪急京都線で振替", isTransferService: true },
    });
    expect(transfer.headline).toBe("振替輸送で向かう");
    const taxi = buildDecisionText({
      ...base,
      bestOption: { kind: "taxi", label: "タクシー", isTransferService: false },
    });
    expect(taxi.headline).toBe("タクシーに乗る");
    expect(
      buildDecisionText({
        ...base,
        language: "en",
        bestOption: {
          kind: "transfer",
          label: "Via Hankyu Kyoto Line",
          isTransferService: false,
          legs: [
            { ...HANKYU_WALK, to: "Osaka-umeda" },
            { ...HANKYU_RIDE, from: "Osaka-umeda", line: "Hankyu Kyoto Line" },
          ],
        },
      }).headline,
    ).toBe("Walk to Osaka-umeda for the Hankyu Kyoto Line.");
  });

  it("理由は再開見込みと分岐点を比べる形で書く", () => {
    const input = {
      reason: "resume_after_break_even" as const,
      breakEvenMinutesFromNow: 13,
      bestOption: { kind: "transfer" as const, label: "阪急京都線で振替", isTransferService: true },
      ...OUTLOOK,
    };
    // 先頭の文は待つ場合と比べ、境目という言葉だけで結果を言わない
    const ja = buildDecisionText({ ...input, language: "ja" }).reason;
    expect(ja).toBe("待つより振替輸送のほうが早く着きます。再開は23時40分ごろの見込みです。");
    expect(ja).not.toMatch(/境目より|頃/);
    expect(buildDecisionText({ ...input, language: "en" }).reason).toBe(
      "The transfer service is faster than waiting. Restart is expected around 23:40.",
    );
  });

  it("流れの区別があっても、理由は再開見込みと境目と確率だけで90字以内に収める", () => {
    const input = {
      reason: "resume_after_break_even" as const,
      language: "ja" as const,
      breakEvenMinutesFromNow: 13,
      bestOption: null,
      ...OUTLOOK,
      flow: { outlook: "long" as const },
      chance: {
        waitFaster: 0,
        comparisonTime: OUTLOOK.breakEvenTime,
        waitOnTime: null,
        keyTick: null,
      },
    };
    const comparison = "待つより代わりの手段のほうが早く着きます。再開は23時40分ごろの見込みです。";
    const chance = "23時23分までに動く見込みは1割未満です。";
    const text = buildDecisionText(input);
    expect(text.reason).toBe(`${comparison}${chance}`);
    expect([...text.reason].length).toBeLessThanOrEqual(90);
    expect(findFlowWording(text.reason, "ja")).toBeNull();
  });

  it("待つときの理由は、見込みが境目より前か、差が小さいかで書き分ける", () => {
    const base = {
      reason: "resume_before_break_even" as const,
      language: "ja" as const,
      breakEvenMinutesFromNow: 30,
      bestOption: null,
      ...OUTLOOK,
    };
    expect(buildDecisionText({ ...base, marginP50Minutes: 10 }).reason).toBe(
      "待つほうが早く着きます。再開は23時40分ごろの見込みです。",
    );
    expect(buildDecisionText({ ...base, marginP50Minutes: -3 }).reason).toBe(
      "乗り換えても大きな差はありません。再開は23時40分ごろの見込みです。",
    );
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
      "If service restarts by 22:44, waiting is at least as fast as the route via Hankyu Kyoto Line arriving at 23:30.",
    );
    expect(buildPassedSentence(time, "Transfer service via Hankyu Kobe Line", arrival, "en")).toBe(
      "If service had restarted by 22:44, waiting would have been at least as fast as the transfer service via Hankyu Kobe Line arriving at 23:30.",
    );
  });

  it("タクシーと徒歩は冠詞や動名詞で文に収める", () => {
    expect(buildBreakEvenSentence(time, "Taxi", arrival, "en")).toBe(
      "If service restarts by 22:44, waiting is at least as fast as a taxi arriving at 23:30.",
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
      "22時44分までに再開すれば23時30分着の阪急京都線より待つほうが早く着けました。",
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
      "8時10分までに再開すれば8時55分着のタクシーに切り替えなくても期限に間に合います。",
    );
    expect(buildDeadlineBreakEvenSentence(time, deadline, "Taxi", arrival, "en")).toBe(
      "If service restarts by 08:10, you meet your 09:00 deadline without switching to a taxi arriving at 08:55.",
    );
  });

  it("分岐点を過ぎたときは、いま再開しても期限に間に合わないと書く", () => {
    expect(buildDeadlinePassedSentence(time, deadline, "タクシー", arrival, "ja")).toBe(
      "8時10分を過ぎたので9時00分の期限に向けて8時55分着のタクシーに切り替えてください。",
    );
    expect(buildDeadlinePassedSentence(time, deadline, "Taxi", arrival, "en")).toBe(
      "The 08:10 cutoff has passed. Switch to a taxi arriving at 08:55 to meet your 09:00 deadline.",
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
      "8時10分を過ぎると、待っても9時00分の期限に間に合いません。再開の見込みは8時06分〜9時37分ごろです。",
    );
    const passed = buildDecisionText({ ...base, reason: "break_even_passed" });
    expect(passed.reason).toBe("いま動いても9時00分の期限に間に合いません。");
    for (const reason of ["unknown_event", "low_confidence", "break_even_passed"] as const) {
      expect(buildDecisionText({ ...base, reason }).reason).not.toContain("が早く着きます");
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
  it("日本語は雨量・傾向・警報を 1 文 1 主張で続けて書く", () => {
    const text = buildWeatherSummary({
      latestMm: 5,
      trend: "falling",
      warnings: ["大雨警報"],
      language: "ja",
    });
    expect(text).toBe("直近の10分雨量は5mmです。雨は弱まっています。大雨警報が出ています。");
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
    expect(en).toBe(
      "The latest 10-min rainfall is 2 mm. Rain is increasing. A weather warning is in effect.",
    );
    expect(/[ぁ-んァ-ヶ一-龥]/.test(en)).toBe(false);
  });
});

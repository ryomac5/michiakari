import type { RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { headlineLimits, reasonLimits } from "../src/config.ts";
import { buildDecisionText, type DecisionReason } from "../src/judge/templates.ts";

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
    it(`${language} の見出しと理由は目安の長さに収まり、見出しは経路名や時刻を含まない`, () => {
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
            expect(text.headline).not.toContain(LONG_LABEL);
            expect(text.headline).not.toMatch(/\d{1,2}(時\d{2}分|:\d{2})/);
            expect(text.reason.length).toBeGreaterThan(0);
            expect([...text.reason].length).toBeLessThanOrEqual(reasonLimits[language].target);
            expect(text.reason).not.toContain(LONG_LABEL);
          }
        }
      }
    });
  }

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

import type { RouteOption } from "@repo/schema";
import { describe, expect, it } from "vitest";
import { headlineLimits } from "../src/config.ts";
import { buildDecisionText, type DecisionReason } from "../src/judge/templates.ts";

// 決定論モードの見出しが短く、理由が見出しと分かれていることを確かめる

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

const OPTIONS: Pick<RouteOption, "kind" | "label" | "isTransferService">[] = [
  { kind: "transfer", label: LONG_LABEL, isTransferService: true },
  { kind: "transfer", label: LONG_LABEL, isTransferService: false },
  { kind: "taxi", label: "タクシー", isTransferService: false },
  { kind: "walk", label: "徒歩", isTransferService: false },
];

describe("buildDecisionText", () => {
  for (const language of ["ja", "en"] as const) {
    it(`${language} の見出しは目安の長さに収まり、経路名や時刻を含まない`, () => {
      for (const reason of REASONS) {
        for (const bestOption of OPTIONS) {
          const text = buildDecisionText({
            reason,
            language,
            breakEvenMinutesFromNow: 120,
            bestOption,
            boardableP50: "2026-11-05T23:50:00+09:00",
          });
          expect([...text.headline].length).toBeLessThanOrEqual(headlineLimits[language].target);
          expect(text.headline).not.toContain(LONG_LABEL);
          expect(text.headline).not.toMatch(/\d{1,2}(時\d{2}分|:\d{2})/);
          expect(text.reason.length).toBeGreaterThan(0);
        }
      }
    });
  }

  it("待つときの見出しは分岐点までの分を示す", () => {
    const input = {
      reason: "resume_before_break_even" as const,
      breakEvenMinutesFromNow: 25,
      bestOption: null,
      boardableP50: "2026-11-05T23:00:00+09:00",
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
      boardableP50: null,
    });
    expect(text.headline).toBe("いま振替に切り替えてください");
    expect(text.reason).toContain("延びました");
  });
});

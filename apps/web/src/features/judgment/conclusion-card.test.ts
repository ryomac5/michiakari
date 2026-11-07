import type { Judgment } from "@repo/schema";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConclusionDetail, selectCardReason } from "./components/ConclusionCard";
import { testIds } from "./testids";

vi.mock("next-intl", () => ({
  useLocale: () => "ja",
  useTranslations: () => (key: string) => key,
}));

function buildJudgment(reason?: string): Judgment {
  return {
    action: "wait",
    headline: "このまま待つ",
    reason,
    estimate: {
      eventType: "medical_response",
      phaseId: null,
      elapsedMinutes: 0,
      remaining: null,
      confidence: "medium",
    },
    breakEven: null,
    options: [],
    recommendedOptionId: null,
    evidence: [],
    disclaimer: "推定です。公式発表を優先する。",
  };
}

describe("結論カードの理由", () => {
  it.each([
    [
      "再開見込み23時40分頃は分岐点23時23分より後です。確率は1割未満です。",
      "再開見込み23時40分頃は分岐点23時23分より後です。",
    ],
    [
      "Expect to reach Tsukamoto at 22:14. This assumes usual spacing.",
      "Expect to reach Tsukamoto at 22:14.",
    ],
    ["Expect a 2.5 min wait. Stay on board.", "Expect a 2.5 min wait."],
    ["このまま待つ", "このまま待つ"],
  ])("先頭の1文を要約にする: %s", (reason, summary) => {
    expect(selectCardReason(buildJudgment(reason))).toBe(summary);
  });

  it("要約に出ない補足だけを詳細に残す", () => {
    const reason =
      "塚本には再開後の22時40分ごろに着く見込みです。前の快速は塚本に止まれず手前で止まっています。";
    const judgment = buildJudgment(reason);
    expect(selectCardReason(judgment)).toBe("塚本には再開後の22時40分ごろに着く見込みです。");
    const html = renderToStaticMarkup(createElement(ConclusionDetail, { judgment }));
    expect(html).toContain(testIds.judgment.conclusionReasonDetail);
    expect(html).toContain("前の快速は塚本に止まれず手前で止まっています。");
    expect(html).not.toContain("22時40分");
  });

  it("英語でも要約を除いた補足だけを詳細に残す", () => {
    const judgment = buildJudgment("Stay on board. This assumes usual spacing.");
    const html = renderToStaticMarkup(createElement(ConclusionDetail, { judgment }));
    expect(html).toContain(testIds.judgment.conclusionReasonDetail);
    expect(html).toContain("This assumes usual spacing.");
    expect(html).not.toContain("Stay on board.");
  });

  it.each(["このまま待つほうが早く着きます。", "Stay on board.   "])(
    "残りが空の理由は詳細に重ねない: %s",
    (reason) => {
      const judgment = buildJudgment(reason);
      const html = renderToStaticMarkup(createElement(ConclusionDetail, { judgment }));
      expect(html).not.toContain(testIds.judgment.conclusionReasonDetail);
      expect(html).not.toContain(reason.trim());
    },
  );

  it("見込みの確かさが高くなくても、先頭の1文を要約にする", () => {
    const judgment = buildJudgment("運転再開を待ちます。境目は21時05分です。");
    expect(selectCardReason(judgment)).toBe("運転再開を待ちます。");
    const html = renderToStaticMarkup(createElement(ConclusionDetail, { judgment }));
    expect(html).toContain(`data-testid="${testIds.judgment.conclusionReasonDetail}"`);
    expect(html).not.toContain(`data-testid="${testIds.judgment.conclusionReason}"`);
    expect(html).toContain("境目は");
    expect(html).not.toContain("運転再開を待ちます。");
  });

  it("判断・理由がないときは要約を出さない", () => {
    expect(selectCardReason(null)).toBeNull();
    expect(selectCardReason(buildJudgment())).toBeNull();
  });

  it("詳細に見込みの確かさを言い換えて出す", () => {
    const judgment = buildJudgment("このまま待つほうが早く着きます。");
    judgment.estimate.confidence = "low";
    const html = renderToStaticMarkup(createElement(ConclusionDetail, { judgment }));
    expect(html).toContain(`data-testid="${testIds.judgment.confidence}"`);
    expect(html).toContain('data-level="low"');
  });
});

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
      eventType: "in_car_response",
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
    typicalFlow: {
      eventType: "in_car_response",
      predictability: {
        level: "high",
        source: "knowledge",
        basis: { ja: "短く終わることが多い", en: "Usually short" },
      },
      phases: [{ id: "check", name: { ja: "確認", en: "Check" }, duration: { p50: 5, p80: 10 } }],
      untilResume: { p50: 5, p80: 10 },
      firstTrainWait: { p50: 0, p80: 0 },
      typicalFloorMinutes: null,
    },
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
      expect(renderToStaticMarkup(createElement(ConclusionDetail, { judgment }))).toBe("");
    },
  );

  it("要約がない理由にも詳細専用のtestidを付ける", () => {
    const judgment = { ...buildJudgment("運転再開を待つ。"), typicalFlow: undefined };
    const html = renderToStaticMarkup(createElement(ConclusionDetail, { judgment }));
    expect(html).toContain(`data-testid="${testIds.judgment.conclusionReasonDetail}"`);
    expect(html).not.toContain(`data-testid="${testIds.judgment.conclusionReason}"`);
    expect(html).toContain("運転再開を待つ。");
  });

  it("判断・理由がないときや流れの確信度が高くないときは要約を出さない", () => {
    expect(selectCardReason(null)).toBeNull();
    expect(selectCardReason(buildJudgment())).toBeNull();
    const judgment = buildJudgment("運転再開を待つ。");
    expect(selectCardReason({ ...judgment, typicalFlow: undefined })).toBeNull();
    if (!judgment.typicalFlow) throw new Error("流れがありません");
    judgment.typicalFlow.predictability.level = "medium";
    expect(selectCardReason(judgment)).toBeNull();
    expect(renderToStaticMarkup(createElement(ConclusionDetail, { judgment }))).toContain(
      "運転再開を待つ。",
    );
  });
});

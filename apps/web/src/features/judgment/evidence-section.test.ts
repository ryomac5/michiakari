import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import { EvidenceSection } from "./components/EvidenceSection";
import { testIds } from "./testids";

describe("根拠の初期表示", () => {
  it.each([
    ["ja", ja],
    ["en", en],
  ] as const)("%s の根拠を閉じた状態で描画する", (locale, messages) => {
    const providerProps = {
      locale,
      messages,
      children: createElement(EvidenceSection, {
        estimate: null,
        signals: [],
        evidence: [{ kind: "computation", id: "break_even", description: "comparison detail" }],
        catalog: [],
      }),
    };
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, providerProps));

    expect(html).toContain(`data-testid="${testIds.judgment.evidenceToggle}"`);
    expect(html).toContain(messages.judgment.evidence.title);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-state="closed"');
    expect(html).not.toContain("comparison detail");
  });
});

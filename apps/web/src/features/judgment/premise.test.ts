import type { Observation } from "@repo/schema";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import { PremiseSection } from "./components/NextCheck";

const session = vi.hoisted(() => ({ observations: [] as Observation[] }));
vi.mock("./session", () => ({ useJudgmentSession: () => session }));

const photo: Observation = {
  id: "photo",
  observedAt: "2026-11-05T22:00:00+09:00",
  source: "photo",
  kind: "train_movement",
  eventTypeCandidates: [],
  operator: null,
  line: null,
  section: null,
  statedResumeTime: null,
  transferServiceActive: null,
  detectedSignals: [],
  trainsAhead: ["rapid", "local"],
};

function renderPremises(locale: "ja" | "en" = "ja") {
  const props = {
    locale,
    messages: locale === "ja" ? ja : en,
    children: createElement(PremiseSection),
  };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, props));
}

describe("画像から読んだ列車の前提", () => {
  beforeEach(() => {
    session.observations = [];
  });

  it("次の観測を足しても、画像で読んだ並びを日本語と英語で残す", () => {
    session.observations = [
      photo,
      { ...photo, id: "text", source: "text", trainsAhead: undefined },
    ];
    expect(renderPremises()).toContain("走行位置の画像から、前の列車を快速・普通と読みました。");
    expect(renderPremises("en")).toContain(
      "We read the trains ahead as rapid · local from your train location image.",
    );
  });

  it("最新の画像の不明を推測せずに表示する", () => {
    session.observations = [photo, { ...photo, id: "new-photo", trainsAhead: ["unknown"] }];
    const markup = renderPremises();
    expect(markup).toContain("走行位置の画像から、前の列車を種別の分からない列車と読みました。");
    expect(markup).not.toContain("快速・普通");
  });

  it("前に列車がいないと読んだ画像を表示する", () => {
    session.observations = [{ ...photo, trainsAhead: [] }];
    expect(renderPremises()).toContain("走行位置の画像から、前に列車はいないと読みました。");
    expect(renderPremises("en")).toContain("We read no trains ahead");
  });

  it("画像で並びを読んでいなければ前提を足さない", () => {
    session.observations = [{ ...photo, trainsAhead: undefined }];
    expect(renderPremises()).toBe("");
  });
});

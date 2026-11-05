import type { Evidence } from "@repo/schema";
import { describe, expect, it } from "vitest";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";
import { selectEvidenceText } from "./evidence-text";

const catalog: KnowledgeCatalog = [
  {
    id: "person_accident",
    name: { ja: "人身事故", en: "Person accident" },
    phases: [
      {
        id: "on_site",
        name: { ja: "現場対応", en: "On-site response" },
        signals: [{ id: "police_on_scene", description: "警察が到着した", example_phrases: [] }],
      },
    ],
  },
];
const context = {
  catalog,
  eventType: "person_accident",
  signals: [
    {
      eventType: "person_accident",
      signalId: "police_on_scene",
      quote: "警察が到着しました",
    },
  ],
  locale: "ja",
};
const item = (kind: Evidence["kind"], id: string, description: string): Evidence => ({
  kind,
  id,
  description,
});

describe("selectEvidenceText", () => {
  it("知見の summary と guidance の文は使わず、事象と段階の名前で組み立てる", () => {
    expect(
      selectEvidenceText(item("knowledge", "person_accident", "知見の要約の文"), context),
    ).toEqual({ key: "event", values: { event: "人身事故" } });
    expect(selectEvidenceText(item("knowledge", "on_site", "段階の手引きの文"), context)).toEqual({
      key: "phase",
      values: { phase: "現場対応" },
    });
    expect(
      selectEvidenceText(item("knowledge", "other", "知見の文"), { ...context, locale: "en" }),
    ).toEqual({ key: "knowledge", values: {} });
  });

  it("兆候は知見の説明ではなく、発表の引用で示す", () => {
    expect(
      selectEvidenceText(item("signal", "police_on_scene", "警察が到着した「…」"), context),
    ).toEqual({ key: "signal", values: { quote: "警察が到着しました" } });
  });

  it("気象と計算は agent が数値から作った文をそのまま使う", () => {
    expect(selectEvidenceText(item("computation", "remaining", "p50 20分"), context)).toEqual({
      key: "raw",
      text: "p50 20分",
    });
  });
});

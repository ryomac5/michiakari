import { describe, expect, it } from "vitest";
import type { KnowledgeCatalog } from "@/features/knowledge/catalog";
import { buildSignalNote } from "./signal-text";

const catalog: KnowledgeCatalog = [
  {
    id: "person_accident",
    name: { ja: "人身事故", en: "Person accident" },
    phases: [
      {
        id: "on_site_check",
        name: { ja: "現場確認", en: "On-site check" },
        signals: [{ id: "police_on_scene", description: "警察が到着した", example_phrases: [] }],
      },
    ],
  },
];

describe("buildSignalNote", () => {
  it("日本語でも知見の説明の文は出さず、段階の名前で組み立てる", () => {
    const note = buildSignalNote(catalog, "person_accident", "police_on_scene", "ja");
    expect(note).toBe("「現場確認」の段階の兆候");
    expect(note).not.toContain("警察が到着した");
  });

  it("英語では日本語の説明を出さず、段階の英語名で組み立てる", () => {
    const note = buildSignalNote(catalog, "person_accident", "police_on_scene", "en");
    expect(note).toBe('Seen in the "On-site check" phase');
    expect(note).not.toMatch(/[぀-ヿ一-鿿]/);
  });

  it("知見に無い兆候は null を返す", () => {
    expect(buildSignalNote(catalog, "person_accident", "unknown", "en")).toBeNull();
  });
});

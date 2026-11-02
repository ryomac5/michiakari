import { join } from "node:path";
import { findRepoRoot } from "@repo/schema/loaders";
import { describe, expect, it } from "vitest";
import { detectDummyContent, sliceYamlLines } from "./document";
import { loadKnowledgeDocuments } from "./load-documents";

// 開発用のダミー知見を読む（読むだけで変更しない）
const devKnowledgeDir = join(findRepoRoot(), "packages/schema/test/fixtures/dev-content/knowledge");

describe("detectDummyContent", () => {
  it("冒頭のコメントにダミーの注記があるものだけを見分ける", () => {
    expect(detectDummyContent("# 開発用のダミー。\n# 補足\nid: a\n")).toBe(true);
    expect(detectDummyContent("\n# 開発用のダミー\nid: a\n")).toBe(true);
    expect(detectDummyContent("id: a\n# 開発用のダミー\n")).toBe(false);
    expect(detectDummyContent("# 知見\nid: a\n")).toBe(false);
  });
});

describe("sliceYamlLines", () => {
  it("1 始まりの行番号で切り出し、末尾の空行を落とす", () => {
    const lines = ["a", "b", "", "c", ""];
    expect(sliceYamlLines(lines, 2, 3)).toEqual({ startLine: 2, endLine: 2, text: "b" });
    expect(sliceYamlLines(lines, 1, 10)).toEqual({ startLine: 1, endLine: 4, text: "a\nb\n\nc" });
  });
});

describe("loadKnowledgeDocuments", () => {
  const documents = loadKnowledgeDocuments(devKnowledgeDir);
  const accident = documents.find((d) => d.knowledge.id === "person_accident");

  it("ダミー知見を読み、ダミーであることを見分ける", () => {
    expect(documents.length).toBeGreaterThan(0);
    expect(accident?.fileName).toBe("person_accident.yaml");
    expect(documents.every((d) => d.dummy)).toBe(true);
  });

  it("段階ごとの YAML の抜粋は、その段階の id から次の段階の手前まで", () => {
    if (!accident) throw new Error("person_accident がありません");
    const phases = accident.knowledge.phases;
    for (const [i, phase] of phases.entries()) {
      const excerpt = accident.excerpts.phases[phase.id];
      expect(excerpt?.text).toMatch(new RegExp(`^\\s*- id: ${phase.id}\\n`));
      for (const signal of phase.signals) expect(excerpt?.text).toContain(`id: ${signal.id}`);
      const next = phases[i + 1];
      if (next) expect(excerpt?.text).not.toContain(`id: ${next.id}\n`);
    }
    expect(accident.excerpts.header.text).toContain("id: person_accident");
    expect(accident.excerpts.header.text).toContain("identification:");
    expect(accident.excerpts.header.text).not.toContain("phases:");
    expect(accident.excerpts.rest.text.startsWith("after_resume:")).toBe(true);
    expect(accident.excerpts.rest.text).toContain("caveats:");
  });
});

import { readFileSync } from "node:fs";
import type { Knowledge } from "@repo/schema";

// システムプロンプトをファイルから読み、知見のブロックを作る

export type Prompts = {
  judgmentSystem: string;
  interpretationSystem: string;
};

function readPrompt(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

export function loadPrompts(): Prompts {
  return {
    judgmentSystem: readPrompt("judgment-system.md"),
    interpretationSystem: readPrompt("interpretation-system.md"),
  };
}

// id 順に並べ、同じ内容なら同じ文字列になるようにする（プロンプトキャッシュのため）
function sortKnowledge(knowledge: ReadonlyMap<string, Knowledge>): Knowledge[] {
  return [...knowledge.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function buildKnowledgeBlock(knowledge: ReadonlyMap<string, Knowledge>): string {
  return `<knowledge>\n${JSON.stringify(sortKnowledge(knowledge), null, 1)}\n</knowledge>`;
}

// 解釈に必要な部分だけを抜き出したカタログ
export function buildKnowledgeCatalog(knowledge: ReadonlyMap<string, Knowledge>): string {
  const catalog = sortKnowledge(knowledge).map((k) => ({
    id: k.id,
    name: k.name,
    identification: k.identification.phrases,
    signals: k.phases.flatMap((p) =>
      p.signals.map((s) => ({
        id: s.id,
        observable_from: s.observable_from,
        description: s.description,
        example_phrases: s.example_phrases,
      })),
    ),
  }));
  return `<knowledge_catalog>\n${JSON.stringify(catalog, null, 1)}\n</knowledge_catalog>`;
}

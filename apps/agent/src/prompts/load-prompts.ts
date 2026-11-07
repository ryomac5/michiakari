import { readFileSync } from "node:fs";
import { INCIDENT_PHRASES, INCIDENT_TYPE_IDS } from "@repo/core";

// システムプロンプトをファイルから読み、解釈に使う種類の表を作る

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

// 解釈に使う、起きていることの種類と一般的な呼び名の表。core の表から作り、並びは固定する（プロンプトキャッシュのため）
export function buildIncidentCatalog(): string {
  const catalog = INCIDENT_TYPE_IDS.map((id) => ({ id, phrases: INCIDENT_PHRASES[id] }));
  return `<incident_catalog>\n${JSON.stringify(catalog, null, 1)}\n</incident_catalog>`;
}

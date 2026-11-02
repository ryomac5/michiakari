// サーバー専用。fs を使うのでクライアントから import しない
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { checkKnowledgeIntegrity } from "@repo/schema";
import { loadKnowledgeDir } from "@repo/schema/loaders";
import { buildCatalogEvent, type KnowledgeCatalog } from "./catalog";

// knowledge/*.yaml を読み、検証に通ったものだけを画面用の抜粋にする
export function loadKnowledgeCatalog(
  dir = resolve(process.cwd(), "../../knowledge"),
): KnowledgeCatalog {
  if (!existsSync(dir)) return [];
  return loadKnowledgeDir(dir)
    .entries.map((entry) => entry.data)
    .filter((knowledge) => checkKnowledgeIntegrity(knowledge).length === 0)
    .map(buildCatalogEvent);
}

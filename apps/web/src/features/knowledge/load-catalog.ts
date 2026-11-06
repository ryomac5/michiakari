// サーバー専用。fs を使うのでクライアントから import しない
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checkKnowledgeIntegrity } from "@repo/schema";
import { loadKnowledgeDir, resolveContentDir } from "@repo/schema/loaders";
import { buildCatalogEvent, type KnowledgeCatalog } from "./catalog";

// 本番では知見が起動中に変わらないので、読んだ結果を使い回す。開発中は編集をすぐ映すため毎回読む
const cachedCatalogs = new Map<string, KnowledgeCatalog>();

// knowledge/*.yaml を読み、検証に通ったものだけを画面用の抜粋にする
// 公開時に読むファイルは next.config.ts の outputFileTracingIncludes で同梱する
export function loadKnowledgeCatalog(
  dir = join(resolveContentDir(), "knowledge"),
): KnowledgeCatalog {
  if (process.env.NODE_ENV !== "production") return readKnowledgeCatalog(dir);
  const cached = cachedCatalogs.get(dir);
  if (cached) return cached;
  const catalog = readKnowledgeCatalog(dir);
  cachedCatalogs.set(dir, catalog);
  return catalog;
}

function readKnowledgeCatalog(dir: string): KnowledgeCatalog {
  if (!existsSync(/*turbopackIgnore: true*/ dir)) return [];
  return loadKnowledgeDir(dir)
    .entries.map((entry) => entry.data)
    .filter((knowledge) => checkKnowledgeIntegrity(knowledge).length === 0)
    .map(buildCatalogEvent);
}

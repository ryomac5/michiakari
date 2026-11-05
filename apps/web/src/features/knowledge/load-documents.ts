// サーバー専用。fs を使うのでクライアントから import しない
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { checkKnowledgeIntegrity } from "@repo/schema";
import { loadKnowledgeDir, resolveContentDir } from "@repo/schema/loaders";
import { buildKnowledgeDocument, type KnowledgeDocument } from "./document";

// knowledge/*.yaml を読み、検証に通ったものを閲覧画面用に整える。YAML の原文も抜粋として持つ
// 公開時に読むファイルは next.config.ts の outputFileTracingIncludes で同梱する
export function loadKnowledgeDocuments(
  dir = join(resolveContentDir(), "knowledge"),
): KnowledgeDocument[] {
  if (!existsSync(/*turbopackIgnore: true*/ dir)) return [];
  return loadKnowledgeDir(dir)
    .entries.filter((entry) => checkKnowledgeIntegrity(entry.data).length === 0)
    .map((entry) =>
      buildKnowledgeDocument({
        knowledge: entry.data,
        text: readFileSync(/*turbopackIgnore: true*/ entry.file, "utf8"),
        fileName: basename(entry.file),
        locateLine: entry.locateLine,
      }),
    );
}

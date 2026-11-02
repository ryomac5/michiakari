import { findRepoRoot, resolveContentDir } from "../src/loaders.ts";
import {
  checkTemplateConformance,
  formatContentError,
  validateContent,
} from "../src/validate-content.ts";

// knowledge/ と scenarios/ を検証する。既定はリポジトリルート、CONTENT_DIR で切り替える

const repoRoot = findRepoRoot();
const rootDir = resolveContentDir(process.env, repoRoot);
const isDefaultRoot = rootDir === repoRoot;
if (!isDefaultRoot) console.log(`読み込み元: ${rootDir}`);

const content = validateContent(rootDir);
console.log(`検証したファイル: ${content.checkedFiles.length} 件`);
for (const file of content.checkedFiles) console.log(`  - ${file}`);

// 雛形はリポジトリルートでのみ必須
const templates = checkTemplateConformance(rootDir, { allowMissing: !isDefaultRoot });
console.log("雛形の整合:");
for (const t of templates) {
  const status = t.skipped
    ? "雛形なし (CONTENT_DIR 指定のため省略)"
    : t.errors.length === 0
      ? "スキーマとキー構造が一致"
      : "不一致";
  console.log(`  ${t.file}: ${status}`);
}

const errors = [
  ...content.errors.map(formatContentError),
  ...templates.flatMap((t) => t.errors.map((e) => `${t.file}: ${e}`)),
];

if (errors.length > 0) {
  console.log(`エラー: ${errors.length} 件`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log("エラーはありません");

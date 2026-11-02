import { resolve } from "node:path";
import {
  checkTemplateConformance,
  formatContentError,
  validateContent,
} from "../src/validate-content.ts";

// リポジトリルートの knowledge/ と scenarios/ を検証する

const rootDir = resolve(import.meta.dirname, "../../..");

const content = validateContent(rootDir);
console.log(`検証したファイル: ${content.checkedFiles.length} 件`);
for (const file of content.checkedFiles) console.log(`  - ${file}`);

const templates = checkTemplateConformance(rootDir);
console.log("雛形の整合:");
for (const t of templates) {
  console.log(`  ${t.file}: ${t.errors.length === 0 ? "スキーマとキー構造が一致" : "不一致"}`);
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

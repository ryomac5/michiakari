// scenarios/ の無断変更と、knowledge/ や非公開の材料の混入を検出する。1つでも失敗すれば exit 1
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkApproval,
  checkBranchDiff,
  checkKnowledgeUntracked,
  checkPrivateNotes,
  findSymlinks,
  formatDiffLines,
  RECORD_FILE,
  runValidate,
} from "./lib/guard-core.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const reportApproval = () => {
  const results = checkApproval(rootDir);
  for (const result of results) {
    if (result.reason === "missing") {
      console.log(`[失敗] 承認記録: ${result.name}/${RECORD_FILE} がありません`);
    } else if (result.ok) {
      console.log(`[合格] 承認記録: ${result.name}/ は承認済みの内容と一致`);
    } else {
      console.log(`[失敗] 承認記録: ${result.name}/ に未承認の差分があります`);
      for (const line of result.invalidLines) console.log(`  不正な記録行: ${line}`);
      for (const line of formatDiffLines(result.name, result.diff)) console.log(line);
    }
  }
  return results.every((result) => result.ok);
};

const reportSymlinks = () => {
  const symlinks = findSymlinks(rootDir);
  if (symlinks.length === 0) {
    console.log("[合格] シンボリックリンク: 保護ディレクトリ内にありません");
    return true;
  }
  console.log("[失敗] シンボリックリンク: 保護ディレクトリ内にあります");
  for (const path of symlinks) console.log(`  ${path}`);
  return false;
};

const reportBranchDiff = () => {
  const result = checkBranchDiff(rootDir);
  switch (result.status) {
    case "skip":
      console.log("[省略] ブランチ差分: main 上のため検査しません");
      return true;
    case "warn":
      console.log(
        result.reason === "not-git"
          ? "[警告] ブランチ差分: git 管理外のため検査できません"
          : "[警告] ブランチ差分: main ref が無いため検査できません",
      );
      return true;
    case "pass":
      console.log("[合格] ブランチ差分: main からの差分に保護ディレクトリの変更はありません");
      return true;
    default:
      console.log("[失敗] ブランチ差分: main からの差分に保護ディレクトリの変更があります");
      for (const path of result.files) console.log(`  ${path}`);
      return false;
  }
};

const reportValidate = () => {
  const status = runValidate(rootDir, { stdio: ["ignore", "ignore", "ignore"] });
  if (status === 0) {
    console.log("[合格] 内容検証: pnpm validate が成功");
    return true;
  }
  console.log(`[失敗] 内容検証: pnpm validate が終了コード ${status} で失敗`);
  return false;
};

const reportKnowledgeUntracked = () => {
  const result = checkKnowledgeUntracked(rootDir);
  if (result.status === "warn") {
    console.log("[警告] 知見の非追跡: git 管理外のため検査できません");
    return true;
  }
  if (result.status === "pass") {
    console.log(
      "[合格] 知見の非追跡: knowledge/ に README.md と _template.yaml と古い承認記録以外の追跡はありません",
    );
    return true;
  }
  console.log("[失敗] 知見の非追跡: knowledge/ に追跡されているファイルがあります");
  for (const path of result.files) console.log(`  ${path}`);
  return false;
};

const reportPrivateNotes = () => {
  const result = checkPrivateNotes(rootDir);
  if (result.status === "skip") {
    console.log("[警告] 非公開の材料: PRIVATE_NOTES_DIR が無いか存在しないため検査を省きます");
    return true;
  }
  if (result.status === "warn") {
    console.log("[警告] 非公開の材料: git 管理外のため検査できません");
    return true;
  }
  if (result.status === "pass") {
    console.log("[合格] 非公開の材料: 追跡中のファイルに一致する文はありません");
    return true;
  }
  console.log("[失敗] 非公開の材料: 追跡中のファイルに一致する文があります");
  for (const path of result.files) console.log(`  ${path}`);
  return false;
};

const results = [
  reportApproval(),
  reportSymlinks(),
  reportBranchDiff(),
  reportKnowledgeUntracked(),
  reportPrivateNotes(),
  reportValidate(),
];
const passed = results.every(Boolean);
console.log(passed ? "guard: 合格" : "guard: 不合格");
process.exit(passed ? 0 : 1);

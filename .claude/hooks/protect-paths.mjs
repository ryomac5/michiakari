// scenarios/ への書き込みと、非公開の材料の置き場（PRIVATE_NOTES_DIR）への書き込みを遮断する
// scenarios/ は開発者が意図して編集するときだけ ALLOW_PROTECTED_EDIT=1 を設定して起動する
// PRIVATE_NOTES_DIR の配下は ALLOW_PROTECTED_EDIT=1 でも遮断する
import { isAbsolute, relative, resolve } from "node:path";

const PROTECTED_DIRS = ["scenarios"];

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const isProtected = (filePath, projectDir) => {
  const rel = relative(projectDir, resolve(projectDir, filePath));
  return PROTECTED_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
};

const isInPrivateNotes = (filePath, projectDir, notesDir) => {
  if (!notesDir) return false;
  const rel = relative(resolve(notesDir), resolve(projectDir, filePath));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

const input = JSON.parse(await readStdin());
const filePath = input.tool_input?.file_path ?? "";
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

if (filePath && isInPrivateNotes(filePath, projectDir, process.env.PRIVATE_NOTES_DIR)) {
  process.stderr.write(
    `${filePath} は非公開の材料の置き場のため変更できません。開発者本人が書く領域です。\n`,
  );
  process.exit(2);
}

if (process.env.ALLOW_PROTECTED_EDIT !== "1" && filePath && isProtected(filePath, projectDir)) {
  process.stderr.write(
    `${filePath} は開発者本人が書く領域のため変更できません。問題があれば docs/progress.md の「開発者に確認したいこと」に書いてください。\n`,
  );
  process.exit(2);
}

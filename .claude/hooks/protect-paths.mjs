// knowledge/ と scenarios/ への書き込みを遮断する（開発者本人が書く領域）
// 開発者が意図して編集するときは ALLOW_PROTECTED_EDIT=1 を設定して起動する
import { relative, resolve } from "node:path";

const PROTECTED_DIRS = ["knowledge", "scenarios"];

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const isProtected = (filePath, projectDir) => {
  const rel = relative(projectDir, resolve(projectDir, filePath));
  return PROTECTED_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
};

const input = JSON.parse(await readStdin());
const filePath = input.tool_input?.file_path ?? "";
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

if (process.env.ALLOW_PROTECTED_EDIT !== "1" && filePath && isProtected(filePath, projectDir)) {
  process.stderr.write(
    `${filePath} は開発者本人が書く領域のため変更できません。問題があれば docs/progress.md の「開発者に確認したいこと」に書いてください。\n`,
  );
  process.exit(2);
}

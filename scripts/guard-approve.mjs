// 開発者が knowledge/ と scenarios/ の現在の内容を承認し、記録を書き出す
// TTY での確認を必須にし、エージェントが代行できないようにする
import { closeSync, openSync, readSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeManifest,
  diffManifests,
  findSymlinks,
  formatDiffLines,
  hasDiff,
  PROTECTED_DIRS,
  readManifest,
  runValidate,
  writeManifest,
} from "./lib/guard-core.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const reject = (message) => {
  console.error(`guard:approve: ${message}`);
  process.exit(1);
};

const collectChanges = () =>
  PROTECTED_DIRS.map((name) => {
    const dir = join(rootDir, name);
    const current = computeManifest(dir);
    const record = readManifest(dir);
    const diff = diffManifests(record?.entries ?? new Map(), current);
    return {
      name,
      dir,
      current,
      diff,
      needsWrite: record === null || record.invalidLines.length > 0 || hasDiff(diff),
    };
  });

// /dev/tty から1行読む。開けなければ null
const askOnTty = (question) => {
  let fd;
  try {
    fd = openSync("/dev/tty", "r+");
  } catch {
    return null;
  }
  writeSync(fd, question);
  const buffer = Buffer.alloc(1);
  let answer = "";
  while (readSync(fd, buffer, 0, 1, null) === 1) {
    const char = buffer.toString("utf8");
    if (char === "\n") break;
    answer += char;
  }
  closeSync(fd);
  return answer.trim();
};

// biome-ignore lint/suspicious/noUndeclaredEnvVars: turbo を経由せず開発者が直接設定する
if (process.env.ALLOW_PROTECTED_EDIT !== "1") {
  reject("ALLOW_PROTECTED_EDIT=1 が設定されていないため拒否します");
}

const symlinks = findSymlinks(rootDir);
if (symlinks.length > 0) {
  reject(`保護ディレクトリ内にシンボリックリンクがあるため拒否します: ${symlinks.join(", ")}`);
}

if (runValidate(rootDir, { stdio: ["ignore", "inherit", "inherit"] }) !== 0) {
  reject("pnpm validate が失敗したため記録を書きません");
}

const changes = collectChanges();
if (changes.every((change) => !change.needsWrite)) {
  console.log("承認済みの内容から変更はありません");
  process.exit(0);
}

console.log("次の内容を承認します:");
for (const { name, diff } of changes) {
  for (const line of formatDiffLines(name, diff)) console.log(line);
}

const answer = askOnTty("承認記録を書き出しますか? [y/N] ");
if (answer === null) reject("TTY が無いため確認できません。承認は開発者が端末で実行してください");
if (answer.toLowerCase() !== "y") reject("承認を取り消しました");

for (const { dir, current } of changes) writeManifest(dir, current);
console.log("承認記録を書き出しました");

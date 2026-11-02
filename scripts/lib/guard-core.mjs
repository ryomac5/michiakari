// knowledge/ と scenarios/ の無断変更を検出するための判定ロジック
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const PROTECTED_DIRS = ["knowledge", "scenarios"];
export const RECORD_FILE = ".approved.sha256";
const IGNORED_NAMES = new Set([".DS_Store"]);
const RECORD_LINE = /^([0-9a-f]{64}) {2}(.+)$/;

export const hashFile = (filePath) =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const toPosix = (path) => path.split(sep).join("/");

// ディレクトリを再帰的に走査し、通常ファイルとシンボリックリンクを分けて返す
export const walkDir = (dir) => {
  const files = [];
  const symlinks = [];
  if (!existsSync(dir)) return { files, symlinks };
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      const rel = toPosix(relative(dir, fullPath));
      if (entry.isSymbolicLink()) {
        symlinks.push(rel);
      } else if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && !IGNORED_NAMES.has(entry.name) && rel !== RECORD_FILE) {
        files.push(rel);
      }
    }
  };
  visit(dir);
  return { files: files.sort(), symlinks: symlinks.sort() };
};

export const findSymlinks = (rootDir, dirs = PROTECTED_DIRS) =>
  dirs.flatMap((name) => walkDir(join(rootDir, name)).symlinks.map((rel) => `${name}/${rel}`));

export const computeManifest = (dir) =>
  new Map(walkDir(dir).files.map((rel) => [rel, hashFile(join(dir, rel))]));

export const formatManifest = (manifest) =>
  [...manifest.keys()]
    .sort()
    .map((rel) => `${manifest.get(rel)}  ${rel}\n`)
    .join("");

export const parseManifest = (text) => {
  const entries = new Map();
  const invalidLines = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const match = RECORD_LINE.exec(line);
    if (match) entries.set(match[2], match[1]);
    else invalidLines.push(line);
  }
  return { entries, invalidLines };
};

// 記録ファイルが無ければ null を返す
export const readManifest = (dir) => {
  const recordPath = join(dir, RECORD_FILE);
  if (!existsSync(recordPath)) return null;
  return parseManifest(readFileSync(recordPath, "utf8"));
};

export const writeManifest = (dir, manifest) => {
  writeFileSync(join(dir, RECORD_FILE), formatManifest(manifest));
};

export const diffManifests = (approved, current) => {
  const added = [...current.keys()].filter((rel) => !approved.has(rel)).sort();
  const removed = [...approved.keys()].filter((rel) => !current.has(rel)).sort();
  const changed = [...current.keys()]
    .filter((rel) => approved.has(rel) && approved.get(rel) !== current.get(rel))
    .sort();
  return { added, removed, changed };
};

export const hasDiff = ({ added, removed, changed }) =>
  added.length + removed.length + changed.length > 0;

// 1ディレクトリ分の承認記録と作業ツリーを照合する
export const checkApprovalDir = (rootDir, name) => {
  const dir = join(rootDir, name);
  const current = computeManifest(dir);
  const record = readManifest(dir);
  if (record === null) {
    return { name, ok: false, reason: "missing", diff: diffManifests(new Map(), current) };
  }
  const diff = diffManifests(record.entries, current);
  const ok = record.invalidLines.length === 0 && !hasDiff(diff);
  return { name, ok, reason: ok ? "match" : "mismatch", diff, invalidLines: record.invalidLines };
};

export const checkApproval = (rootDir, dirs = PROTECTED_DIRS) =>
  dirs.map((name) => checkApprovalDir(rootDir, name));

export const formatDiffLines = (name, { added, removed, changed }) => [
  ...added.map((rel) => `  追加: ${name}/${rel}`),
  ...removed.map((rel) => `  削除: ${name}/${rel}`),
  ...changed.map((rel) => `  変更: ${name}/${rel}`),
];

const runGit = (rootDir, args) =>
  execFileSync("git", ["-C", rootDir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

const tryRunGit = (rootDir, args) => {
  try {
    return runGit(rootDir, args);
  } catch {
    return null;
  }
};

const splitLines = (text) => text.split("\n").filter((line) => line !== "");

// main との分岐点から作業ツリーまでに保護ディレクトリの変更があるかを調べる
export const checkBranchDiff = (rootDir, { baseRef = "main", dirs = PROTECTED_DIRS } = {}) => {
  if (tryRunGit(rootDir, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return { status: "warn", reason: "not-git", files: [] };
  }
  const branch = tryRunGit(rootDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === baseRef) return { status: "skip", reason: "on-base", files: [] };
  if (tryRunGit(rootDir, ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]) === null) {
    return { status: "warn", reason: "no-base", files: [] };
  }
  const base = runGit(rootDir, ["merge-base", "HEAD", baseRef]);
  const pathspec = ["--", ...dirs];
  const files = new Set([
    ...splitLines(runGit(rootDir, ["diff", "--name-only", base, ...pathspec])),
    ...splitLines(runGit(rootDir, ["diff", "--name-only", "--cached", base, ...pathspec])),
  ]);
  const sorted = [...files].sort();
  return { status: sorted.length === 0 ? "pass" : "fail", reason: "diff", base, files: sorted };
};

// pnpm validate を実行し、終了コードを返す
// CONTENT_DIR は引き継がない（本物の knowledge/ と scenarios/ を検証するため）
export const runValidate = (rootDir, { stdio = "inherit", env = process.env } = {}) => {
  const { CONTENT_DIR: _omitted, ...childEnv } = env;
  const result = spawnSync("pnpm", ["validate"], { cwd: rootDir, stdio, env: childEnv });
  return result.status ?? 1;
};

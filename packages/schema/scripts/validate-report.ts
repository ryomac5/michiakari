import { existsSync, type FSWatcher, watch } from "node:fs";
import { join } from "node:path";
import {
  checkTemplateConformance,
  explainContentErrors,
  formatExplainedError,
  sortContentErrors,
  validateContent,
} from "../src/validate-content.ts";

// pnpm validate の出力を組み立てる。表示は呼び出し側が行う

export type ValidationReport = {
  ok: boolean;
  lines: string[];
};

export function buildValidationReport(
  rootDir: string,
  { isDefaultRoot }: { isDefaultRoot: boolean },
): ValidationReport {
  const lines: string[] = [];
  if (!isDefaultRoot) lines.push(`読み込み元: ${rootDir}`);

  const content = validateContent(rootDir);
  lines.push(`検証したファイル: ${content.checkedFiles.length} 件`);
  for (const file of content.checkedFiles) lines.push(`  - ${file}`);

  // 雛形はリポジトリルートでのみ必須
  const templates = checkTemplateConformance(rootDir, { allowMissing: !isDefaultRoot });
  lines.push("雛形の整合:");
  for (const t of templates) {
    const status = t.skipped
      ? "雛形なし (CONTENT_DIR 指定のため省略)"
      : t.errors.length === 0
        ? "スキーマとキー構造が一致"
        : "不一致";
    lines.push(`  ${t.file}: ${status}`);
  }

  const contentErrors = sortContentErrors(explainContentErrors(rootDir, content.errors));
  const templateErrors = templates.flatMap((t) => t.errors.map((e) => `${t.file}: ${e}`));
  const total = contentErrors.length + templateErrors.length;

  if (total === 0) {
    lines.push("エラーはありません");
    return { ok: true, lines };
  }

  lines.push(`エラー: ${total} 件`);
  for (const e of contentErrors) {
    const [first, ...details] = formatExplainedError(e, "      ");
    lines.push(`  - ${first}`, ...details);
  }
  for (const e of templateErrors) lines.push(`  - ${e}`);
  lines.push(...buildFileSummary(contentErrors.map((e) => e.file)));
  return { ok: false, lines };
}

// ファイルごとの件数。2 ファイル以上にエラーがあるときだけ出す
function buildFileSummary(files: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(file, (counts.get(file) ?? 0) + 1);
  if (counts.size < 2) return [];
  return ["ファイルごとの件数:", ...[...counts].map(([file, n]) => `  ${file}: ${n} 件`)];
}

const WATCH_DEBOUNCE_MS = 200;

// scenarios/ の変更を監視し、落ち着いたら onChange を呼ぶ。戻り値で監視を止める
export function watchContentDirs(rootDir: string, onChange: () => void): () => void {
  let timer: NodeJS.Timeout | undefined;
  const schedule = (filename: string | null) => {
    if (filename && !/\.ya?ml$/.test(filename)) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, WATCH_DEBOUNCE_MS);
  };
  const watchers: FSWatcher[] = ["scenarios"]
    .map((name) => join(rootDir, name))
    .filter((dir) => existsSync(dir))
    .map((dir) => watch(dir, { recursive: true }, (_event, filename) => schedule(filename)));
  return () => {
    clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}

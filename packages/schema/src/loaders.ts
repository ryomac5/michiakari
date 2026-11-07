import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type Document, isNode, LineCounter, parseDocument, visit } from "yaml";
import { z } from "zod";
import { type Scenario, ScenarioSchema } from "./scenario.ts";

// scenarios/ の YAML を読む。fs を使うので Node 専用

// start から親へたどり、pnpm-workspace.yaml があるディレクトリを返す
// import.meta.url に依存しない（Turbopack がバンドル時に import と誤認するため）
// turbopackIgnore: 実行時に決まるパスを Turbopack に追跡させない。同梱は apps/web の next.config.ts で指定する
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(/*turbopackIgnore: true*/ start);
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`リポジトリルートが見つかりません: ${start}`);
    dir = parent;
  }
  return dir;
}

// scenarios/ を含むディレクトリ。CONTENT_DIR が無ければリポジトリルート
// 相対パスは cwd ではなくリポジトリルート基準で解決する（pnpm --filter で cwd が変わるため）
export function resolveContentDir(
  env: Record<string, string | undefined> = process.env,
  repoRoot: string = findRepoRoot(),
): string {
  const value = env.CONTENT_DIR?.trim();
  return value ? resolve(repoRoot, value) : repoRoot;
}

export type ContentError = {
  file: string;
  line?: number;
  message: string;
};

export type YamlPath = readonly (string | number)[];

export type ParsedYaml = {
  file: string;
  document: Document;
  value: unknown;
  errors: ContentError[];
  locateLine: (path: YamlPath) => number | undefined;
  lineAt: (offset: number) => number;
};

export type LoadedFile<T> = {
  file: string;
  data: T;
  locateLine: (path: YamlPath) => number | undefined;
};

export type LoadDirResult<T> = {
  // 読み込みの対象にした .yaml のパス
  files: string[];
  // スキーマ検証に通ったもの
  entries: LoadedFile<T>[];
  errors: ContentError[];
};

const zodErrorMap = z.locales.ja().localeError;

// YAML 1.2 として読む。構文エラーと重複キーはエラーとして返す
export function parseYamlFile(file: string): ParsedYaml {
  const lineCounter = new LineCounter();
  const document = parseDocument(readFileSync(file, "utf8"), {
    version: "1.2",
    uniqueKeys: true,
    lineCounter,
  });

  const errors: ContentError[] = document.errors.map((e) => ({
    file,
    line: e.linePos?.[0].line,
    message: `YAML の解析に失敗しました (${e.code}): ${e.message.split("\n")[0]}`,
  }));

  const lineAt = (offset: number): number => lineCounter.linePos(offset).line;

  // 指定したパスの節点の行番号。無ければ親をたどる
  const locateLine = (path: YamlPath): number | undefined => {
    for (let n = path.length; n >= 0; n--) {
      const node = document.getIn(path.slice(0, n), true);
      if (isNode(node) && node.range) return lineAt(node.range[0]);
    }
    return undefined;
  };

  const value = errors.length === 0 ? document.toJS() : undefined;
  return { file, document, value, errors, locateLine, lineAt };
}

// 値として書かれた文字列に TODO が残っていないかを調べる
export function findTodoStrings(parsed: ParsedYaml): ContentError[] {
  const errors: ContentError[] = [];
  visit(parsed.document, {
    Scalar(key, node) {
      if (key === "key" || typeof node.value !== "string" || !node.value.includes("TODO")) return;
      errors.push({
        file: parsed.file,
        line: node.range ? parsed.lineAt(node.range[0]) : undefined,
        message: `TODO が残っています: ${node.value}`,
      });
    },
  });
  return errors;
}

// Zod の検証結果を行番号つきのエラーに変換する
export function validateParsed<T>(parsed: ParsedYaml, schema: z.ZodType<T>): T | null {
  const result = schema.safeParse(parsed.value, { error: zodErrorMap });
  if (result.success) return result.data;

  for (const issue of result.error.issues) {
    const path = issue.path.filter((p): p is string | number => typeof p !== "symbol");
    parsed.errors.push({
      file: parsed.file,
      line: parsed.locateLine(path),
      message: `${path.length > 0 ? path.join(".") : "(ルート)"}: ${issue.message}`,
    });
  }
  return null;
}

// ディレクトリ直下のファイル名を返す。_ で始まるものは対象外
export function listContentFiles(dir: string): { yaml: string[]; yml: string[] } {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .sort();
  return {
    yaml: names.filter((n) => n.endsWith(".yaml")).map((n) => join(dir, n)),
    yml: names.filter((n) => n.endsWith(".yml")).map((n) => join(dir, n)),
  };
}

function loadDir<T>(dir: string, schema: z.ZodType<T>): LoadDirResult<T> {
  const files = listContentFiles(dir).yaml;
  const entries: LoadedFile<T>[] = [];
  const errors: ContentError[] = [];

  for (const file of files) {
    const parsed = parseYamlFile(file);
    if (parsed.errors.length === 0) {
      parsed.errors.push(...findTodoStrings(parsed));
      const data = validateParsed(parsed, schema);
      if (data !== null) entries.push({ file, data, locateLine: parsed.locateLine });
    }
    errors.push(...parsed.errors);
  }

  return { files, entries, errors };
}

export function loadScenarioDir(dir: string): LoadDirResult<Scenario> {
  return loadDir(dir, ScenarioSchema);
}

// 拡張子を除いたファイル名
export function getFileStem(file: string): string {
  return basename(file).replace(/\.ya?ml$/, "");
}

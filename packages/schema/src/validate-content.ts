import { existsSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { isPair, isScalar, isSeq, visit } from "yaml";
import { z } from "zod";
import { findDuplicateIds } from "./internal.ts";
import {
  type ContentError,
  type LoadDirResult,
  listContentFiles,
  loadScenarioDir,
  parseYamlFile,
  type YamlPath,
} from "./loaders.ts";
import { checkScenarioIntegrity, ScenarioSchema } from "./scenario.ts";

// scenarios/ の内容検証。Node 専用。知見は判断に使わないので検証しない

export type ContentValidationResult = {
  // 検証した .yaml（rootDir からの相対パス）
  checkedFiles: string[];
  errors: ContentError[];
};

export type TemplateConformance = {
  file: string;
  errors: string[];
  // 雛形が無く、allowMissing により検査を省いたとき true
  skipped?: boolean;
};

const SCENARIO_DIR = "scenarios";

// エラーを 1 行の文字列にする
export function formatContentError(e: ContentError): string {
  return `${e.file}${e.line !== undefined ? `:${e.line}` : ""}: ${e.message}`;
}

export function validateContent(rootDir: string): ContentValidationResult {
  const errors: ContentError[] = [];
  const toRelative = (file: string) => relative(rootDir, file);

  const scenarioDir = join(rootDir, SCENARIO_DIR);
  if (!existsSync(scenarioDir)) {
    return {
      checkedFiles: [],
      errors: [{ file: toRelative(scenarioDir), message: "ディレクトリがありません" }],
    };
  }
  for (const file of listContentFiles(scenarioDir).yml) {
    errors.push({ file, message: "拡張子は .yaml にしてください (.yml は使わない)" });
  }

  const scenarios = loadScenarioDir(scenarioDir);
  errors.push(...scenarios.errors);
  errors.push(...checkFileLevel(scenarios, checkScenarioIntegrity));
  errors.push(...checkUniqueIds(scenarios, "シナリオ"));

  return {
    checkedFiles: scenarios.files.map(toRelative),
    errors: errors.map((e) => ({ ...e, file: toRelative(e.file) })),
  };
}

function checkFileLevel<T>(
  result: LoadDirResult<T>,
  checkIntegrity: (data: T) => string[],
): ContentError[] {
  return result.entries.flatMap(({ file, data }) =>
    checkIntegrity(data).map((message) => ({ file, message })),
  );
}

function checkUniqueIds<T extends { id: string }>(
  result: LoadDirResult<T>,
  label: string,
): ContentError[] {
  const ids = result.entries.map((e) => e.data.id);
  return findDuplicateIds(ids).map((id) => {
    const files = result.entries.filter((e) => e.data.id === id).map((e) => e.file);
    return {
      file: files[0] ?? "",
      message: `${label}の id が複数のファイルで重複しています: ${id} (${files.map((f) => basename(f)).join(", ")})`,
    };
  });
}

// 雛形とスキーマのキー構造を突き合わせる。値は見ない
// allowMissing は雛形を置かない CONTENT_DIR 用。雛形が無くても失敗にしない
export function checkTemplateConformance(
  rootDir: string,
  { allowMissing = false }: { allowMissing?: boolean } = {},
): TemplateConformance[] {
  const targets = [{ file: `${SCENARIO_DIR}/_template.yaml`, schema: ScenarioSchema }];

  return targets.map(({ file, schema }) => {
    const path = join(rootDir, file);
    if (!existsSync(path)) {
      return allowMissing
        ? { file, errors: [], skipped: true }
        : { file, errors: ["雛形がありません"] };
    }

    const parsed = parseYamlFile(path);
    if (parsed.errors.length > 0) return { file, errors: parsed.errors.map((e) => e.message) };

    return { file, errors: compareKeyStructure(schema, parsed.value, "") };
  });
}

// optional / nullable / default を外した中身と、キーを省略できるかを返す
function unwrapField(schema: z.core.$ZodType): { inner: z.core.$ZodType; optional: boolean } {
  let inner = schema;
  let optional = false;
  for (;;) {
    if (inner instanceof z.ZodOptional) {
      optional = true;
      inner = inner.unwrap();
    } else if (inner instanceof z.ZodDefault) {
      optional = true;
      inner = inner.unwrap();
    } else if (inner instanceof z.ZodNullable) {
      inner = inner.unwrap();
    } else {
      return { inner, optional };
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareKeyStructure(schema: z.core.$ZodType, value: unknown, path: string): string[] {
  const { inner } = unwrapField(schema);

  if (inner instanceof z.ZodObject) {
    if (!isPlainObject(value)) return [`${path || "(ルート)"}: オブジェクトであるべき箇所です`];
    const shape = inner.shape as Record<string, z.core.$ZodType>;
    const errors: string[] = [];

    for (const key of Object.keys(value)) {
      if (!(key in shape)) errors.push(`${appendPath(path, key)}: スキーマに無いキーです`);
    }
    for (const [key, field] of Object.entries(shape)) {
      const childPath = appendPath(path, key);
      if (key in value) {
        errors.push(...compareKeyStructure(field, value[key], childPath));
      } else if (!unwrapField(field).optional) {
        errors.push(`${childPath}: スキーマの必須キーが雛形にありません`);
      }
    }
    return errors;
  }

  if (inner instanceof z.ZodArray && Array.isArray(value)) {
    return value.flatMap((item, i) => compareKeyStructure(inner.element, item, `${path}[${i}]`));
  }

  // スカラーの位置に入れ子のキーがあれば、そのキーはスキーマに無い
  if (isPlainObject(value)) {
    return Object.keys(value).map((key) => `${appendPath(path, key)}: スキーマに無いキーです`);
  }
  return [];
}

function appendPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

// ---- エラーの説明と直し方 ----
// 開発者が YAML を直しやすいよう、エラーに日本語の説明と短いヒントを添える

export type ExplainedContentError = ContentError & {
  explanation?: string;
  hint?: string;
};

type Explanation = { explanation: string; hint: string };

// 項目名の日本語。場所の表示に使う
const SEGMENT_LABELS: Record<string, string> = {
  id: "id",
  title: "題名",
  ja: "日本語",
  en: "英語",
  notes: "補足",
  weather: "気象",
  event_type: "事象の種別",
  operator: "事業者",
  line: "路線",
  blocked_section: "止まっている区間",
  from_station: "起点の駅",
  to_station: "終点の駅",
  start_time: "開始時刻",
  user: "利用者",
  current_station: "現在の駅",
  destination: "目的地",
  constraints: "制約",
  deadline: "期限",
  knows_alternatives: "代替経路を知っているか",
  mobility_notes: "移動の制約",
  language: "言語",
  timeline: "観測",
  offset_minutes: "経過分",
  kind: "種類",
  text: "文面",
  expectations: "期待",
  after: "判断の時点",
  action: "行動",
  phase: "段階",
  evidence_includes: "根拠の兆候",
  break_even_shown: "分岐点の表示",
  note: "メモ",
  ground_truth: "結末",
  resume_offset_minutes: "再開までの分",
  readings: "観測値",
  rainfall_10min_mm: "10 分間降水量",
  warnings: "警報",
};

const OBSERVABLE_KINDS = "announcement、signage、station_broadcast、weather、train_movement";

// 項目ごとの書き方。キーは配列の添字を * にしたパス
const SCENARIO_HOW_TO: Record<string, string> = {
  id: "シナリオを表す id を書いてください。例: person_accident_last_train",
  "title.ja": "どんな状況かが分かる題名を書いてください",
  event_type: "統計値の種類の id を書いてください。例: person_collision",
  operator: "事業者名を書いてください。例: JR西日本",
  line: "路線名を書いてください。例: JR京都線",
  "blocked_section.from_station": "止まっている区間の端の駅名を書いてください。例: 高槻",
  "blocked_section.to_station": "止まっている区間の端の駅名を書いてください。例: 山崎",
  start_time: '日付と時刻を T で区切り、時差まで書いてください。例: "2026-11-05T22:40:00+09:00"',
  "user.current_station": "利用者がいる駅名を書いてください。例: 大阪",
  "user.destination": "目的地の駅名を書いてください。例: 京都",
  "user.constraints.deadline": '"23:45" のように時と分を書くか、期限が無ければ null です',
  "user.constraints.knows_alternatives": "true か false を書いてください",
  "user.constraints.mobility_notes": "移動の制約を書くか、無ければ null です。例: 大きな荷物",
  "user.language": "ja か en を書いてください",
  "timeline.*.id": "観測を表す id を書いてください。例: obs_1",
  "timeline.*.offset_minutes":
    "start_time からの経過を 0 以上の整数の分で書き、昇順に並べてください",
  "timeline.*.kind": `${OBSERVABLE_KINDS} から選んでください`,
  "timeline.*.text.ja": "発表文や掲示の文面を自作して書いてください。実在の発表文は転載しません",
  "expectations.*": "action、phase、evidence_includes、break_even_shown のどれかを書いてください",
  "expectations.*.after": "timeline の id を書いてください。例: obs_1",
  "expectations.*.action": "wait、switch、hold から選ぶか、検査しないなら行ごと消してください",
  "expectations.*.phase": "phase は検査しません。行ごと消してかまいません",
  "expectations.*.evidence_includes.*":
    "放送の手がかりの id を書くか、検査しないなら evidence_includes ごと消してください。例: resumed",
  "expectations.*.break_even_shown": "true か false を書くか、検査しないなら行ごと消してください",
  "expectations.*.note": "なぜそう振る舞うべきかを書いてください",
  "ground_truth.resume_offset_minutes":
    "start_time から運転再開までの分を整数で書くか、再開しないなら null です",
  "ground_truth.notes": "架空の結末を書いてください。デモの最後の比較に使います",
  "weather.readings.*.offset_minutes": "start_time からの経過分を書き、狭義の昇順に並べてください",
  "weather.readings.*.rainfall_10min_mm": "10 分間降水量を 0 以上の数値の mm で書いてください",
  "weather.readings.*.warnings.*": "発表中の警報や注意報の名前を書いてください。例: 大雨警報",
};

const ID_RULE_HINT = "英小文字で始め、英小文字・数字・_ だけで書いてください";
const TODO_HINT = "TODO を実際の内容に書き換えてください";

function checkScenarioFile(file: string): boolean {
  return file.startsWith(`${SCENARIO_DIR}/`);
}

function normalizePath(path: YamlPath): string {
  return path.map((p) => (typeof p === "number" ? "*" : p)).join(".");
}

// パスを「観測 1 › 文面 › 日本語」の形にする
export function describeYamlPath(path: YamlPath): string {
  const parts: string[] = [];
  for (const segment of path) {
    if (typeof segment === "number") {
      const last = parts.pop() ?? "";
      parts.push(`${last} ${segment + 1}`);
    } else {
      parts.push(SEGMENT_LABELS[segment] ?? segment);
    }
  }
  return parts.length > 0 ? parts.join(" › ") : "ファイルの最上位";
}

function findHowTo(path: YamlPath): string | undefined {
  const table = SCENARIO_HOW_TO;
  const found = table[normalizePath(path)];
  if (found) return found;
  const last = path[path.length - 1];
  if (last === "en") return "英語で書くか、不要なら行ごと消してください";
  if (last === "ja") return "日本語で書いてください";
  return undefined;
}

type ReparsedFile = {
  value: unknown;
  issues: z.core.$ZodIssue[];
  todoPaths: YamlPath[];
};

// 祖先の並びから YAML 上のパスを組み立てる
function buildPathFromAncestors(ancestors: readonly unknown[], node: unknown): YamlPath {
  const chain = [...ancestors, node];
  const path: (string | number)[] = [];
  chain.forEach((item, i) => {
    if (isPair(item)) {
      path.push(isScalar(item.key) ? String(item.key.value) : String(item.key));
    } else if (isSeq(item) && i + 1 < chain.length) {
      path.push(item.items.indexOf(chain[i + 1] as never));
    }
  });
  return path;
}

// 説明を作るためにファイルを読み直し、Zod の指摘と TODO の位置を集める
function reparseForExplanation(path: string): ReparsedFile | null {
  if (!existsSync(path)) return null;
  const parsed = parseYamlFile(path);
  if (parsed.errors.length > 0) return { value: undefined, issues: [], todoPaths: [] };

  const todoPaths: YamlPath[] = [];
  visit(parsed.document, {
    Scalar(key, node, ancestors) {
      if (key === "key" || typeof node.value !== "string" || !node.value.includes("TODO")) return;
      todoPaths.push(buildPathFromAncestors(ancestors, node));
    },
  });
  const schema = ScenarioSchema;
  const result = schema.safeParse(parsed.value);
  return { value: parsed.value, issues: result.success ? [] : result.error.issues, todoPaths };
}

function readValueAt(value: unknown, path: YamlPath): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

const TYPE_PHRASES: Record<string, string> = {
  number: "は数値で書く必要があります",
  int: "は整数で書く必要があります",
  string: "は文字で書く必要があります",
  boolean: "は true か false で書く必要があります",
  array: "は - で始まる一覧で書く必要があります",
  object: "は入れ子のキーで書く必要があります",
};

function explainInvalidType(
  where: string,
  issue: z.core.$ZodIssueInvalidType,
  actual: unknown,
  howTo: string | undefined,
): Explanation {
  const last = issue.path[issue.path.length - 1];
  if (actual === undefined) {
    return {
      explanation: `${where}がありません。必須の項目です`,
      hint: `キー ${String(last)} を雛形どおりに追加してください。${howTo ?? ""}`.trim(),
    };
  }
  if (actual === null)
    return { explanation: `${where}が空です`, hint: howTo ?? "値を書いてください" };
  return {
    explanation: `${where}${TYPE_PHRASES[issue.expected] ?? "の型が違います"}`,
    hint: howTo ?? "雛形の書き方と見比べてください",
  };
}

function explainZodIssue(issue: z.core.$ZodIssue, value: unknown): Explanation | null {
  const path = issue.path.filter((p): p is string | number => typeof p !== "symbol");
  const where = `「${describeYamlPath(path)}」`;
  const howTo = findHowTo(path);

  switch (issue.code) {
    case "invalid_type":
      return explainInvalidType(where, issue, readValueAt(value, path), howTo);
    case "invalid_value":
      return {
        explanation: `${where}が選べる値ではありません`,
        hint: `${issue.values.map(String).join("、")} から選んでください`,
      };
    case "too_small":
      if (issue.origin === "number") {
        return {
          explanation: `${where}が 0 より小さい値です`,
          hint: howTo ?? "0 以上にしてください",
        };
      }
      return { explanation: `${where}が空です`, hint: howTo ?? "1 つ以上書いてください" };
    case "invalid_format":
      if (issue.format === "datetime") {
        return { explanation: `${where}が日時の形式ではありません`, hint: howTo ?? "" };
      }
      if (issue.message === "HH:MM 形式") {
        return { explanation: `${where}が時刻の形式ではありません`, hint: howTo ?? "" };
      }
      return {
        explanation: `${where}が id の規則に合いません`,
        hint: howTo ? `${ID_RULE_HINT}。${howTo}` : ID_RULE_HINT,
      };
    case "unrecognized_keys":
      return {
        explanation: `${where}にスキーマに無いキーがあります: ${issue.keys.join(", ")}`,
        hint: "キーの綴りとインデントを雛形と見比べてください。不要なら消してください",
      };
    case "custom":
      return { explanation: `${where}の内容が条件を満たしません`, hint: howTo ?? issue.message };
    default:
      return howTo ? { explanation: `${where}の値が正しくありません`, hint: howTo } : null;
  }
}

function explainTodo(path: YamlPath | undefined): Explanation {
  if (!path) return { explanation: "雛形の TODO が残っています", hint: TODO_HINT };
  return {
    explanation: `「${describeYamlPath(path)}」が雛形のままです`,
    hint: findHowTo(path) ?? TODO_HINT,
  };
}

// スキーマ以外の検査のメッセージに対応する説明
const MESSAGE_RULES: { pattern: RegExp; explain: (m: RegExpMatchArray) => Explanation }[] = [
  {
    pattern: /^YAML の解析に失敗しました \(DUPLICATE_KEY\)/,
    explain: () => ({
      explanation: "同じ階層に同じキーが 2 回書かれています",
      hint: "どちらか一方を消すか、インデントを直して正しい階層に移してください",
    }),
  },
  {
    pattern: /^YAML の解析に失敗しました/,
    explain: () => ({
      explanation: "YAML として読めません",
      hint: "インデントの深さ、コロンの後の空白、引用符やかっこの閉じ忘れを確かめてください",
    }),
  },
  {
    pattern: /^拡張子は \.yaml/,
    explain: () => ({
      explanation: "拡張子が .yml のファイルは読み込まれません",
      hint: "ファイル名の末尾を .yaml に変えてください",
    }),
  },
  {
    pattern: /^ディレクトリがありません/,
    explain: () => ({
      explanation: "シナリオのディレクトリが見つかりません",
      hint: "CONTENT_DIR の指定が正しいかを確かめてください",
    }),
  },
  {
    pattern: /^(シナリオ)の id が複数のファイルで重複しています/,
    explain: (m) => ({
      explanation: `同じ id の${m[1]}が複数あります`,
      hint: "どれか一方の id を別の値に変えてください",
    }),
  },
  {
    pattern: /^(timeline) id が重複しています: (\S+)/,
    explain: (m) => ({
      explanation: `${m[1]} の id ${m[2]} が同じファイルの中で 2 回以上使われています`,
      hint: "id はファイルの中で一意にしてください",
    }),
  },
  {
    pattern: /^timeline の offset_minutes が昇順ではありません/,
    explain: () => ({
      explanation: "timeline が時刻順に並んでいません",
      hint: "offset_minutes が小さい順になるよう、観測を並べ替えてください",
    }),
  },
  {
    pattern: /^weather\.readings の offset_minutes が狭義の昇順ではありません/,
    explain: () => ({
      explanation: "気象の観測値が時刻順に並んでいないか、同じ時刻が重なっています",
      hint: "offset_minutes が重ならず小さい順になるよう並べてください",
    }),
  },
  {
    pattern: /^expectations\.after が未定義の timeline id を指しています: (\S+)/,
    explain: (m) => ({
      explanation: `expectations の after にある ${m[1]} が timeline にありません`,
      hint: "timeline に書いた観測の id を書いてください。例: obs_1",
    }),
  },
];

function explainByMessage(message: string): Explanation | null {
  for (const rule of MESSAGE_RULES) {
    const m = message.match(rule.pattern);
    if (m) return rule.explain(m);
  }
  return null;
}

// エラーに説明と直し方を添える。ファイルは rootDir からの相対パスで受け取る
export function explainContentErrors(
  rootDir: string,
  errors: readonly ContentError[],
): ExplainedContentError[] {
  const cache = new Map<string, ReparsedFile | null>();
  const todoCursor = new Map<string, number>();
  const usedIssues = new Set<z.core.$ZodIssue>();

  const reparse = (file: string): ReparsedFile | null => {
    if (!cache.has(file)) cache.set(file, reparseForExplanation(join(rootDir, file)));
    return cache.get(file) ?? null;
  };

  const explainOne = (error: ContentError): Explanation | null => {
    const byMessage = explainByMessage(error.message);
    if (byMessage || !checkScenarioFile(error.file)) return byMessage;
    const reparsed = reparse(error.file);
    if (!reparsed) return null;

    if (error.message.startsWith("TODO が残っています")) {
      const index = todoCursor.get(error.file) ?? 0;
      todoCursor.set(error.file, index + 1);
      return explainTodo(reparsed.todoPaths[index]);
    }

    const issue = reparsed.issues.find((i) => {
      if (usedIssues.has(i)) return false;
      const path = i.path.filter((p) => typeof p !== "symbol").join(".");
      return error.message.startsWith(`${path.length > 0 ? path : "(ルート)"}: `);
    });
    if (!issue) return null;
    usedIssues.add(issue);
    return explainZodIssue(issue, reparsed.value);
  };

  return errors.map((error) => ({ ...error, ...explainOne(error) }));
}

// 1 行目は formatContentError と同じ。説明と直し方を字下げして続ける
export function formatExplainedError(e: ExplainedContentError, indent = "    "): string[] {
  const lines = [formatContentError(e)];
  if (e.explanation) lines.push(`${indent}説明: ${e.explanation}`);
  if (e.hint) lines.push(`${indent}直し方: ${e.hint}`);
  return lines;
}

// ファイル名、行番号の順に並べる。行番号の無いものはそのファイルの先頭に置く
export function sortContentErrors<T extends ContentError>(errors: readonly T[]): T[] {
  return [...errors].sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
}

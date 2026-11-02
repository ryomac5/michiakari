import { existsSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { z } from "zod";
import { findDuplicateIds } from "./internal.ts";
import { checkKnowledgeIntegrity, type Knowledge, KnowledgeSchema } from "./knowledge.ts";
import {
  type ContentError,
  getFileStem,
  type LoadDirResult,
  listContentFiles,
  loadKnowledgeDir,
  loadScenarioDir,
  parseYamlFile,
} from "./loaders.ts";
import { checkScenarioIntegrity, type Scenario, ScenarioSchema } from "./scenario.ts";

// knowledge/ と scenarios/ の内容検証。Node 専用

export type ContentValidationResult = {
  // 検証した .yaml（rootDir からの相対パス）
  checkedFiles: string[];
  errors: ContentError[];
};

export type TemplateConformance = {
  file: string;
  errors: string[];
};

const KNOWLEDGE_DIR = "knowledge";
const SCENARIO_DIR = "scenarios";

// エラーを 1 行の文字列にする
export function formatContentError(e: ContentError): string {
  return `${e.file}${e.line !== undefined ? `:${e.line}` : ""}: ${e.message}`;
}

export function validateContent(rootDir: string): ContentValidationResult {
  const errors: ContentError[] = [];
  const toRelative = (file: string) => relative(rootDir, file);

  const dirs = [KNOWLEDGE_DIR, SCENARIO_DIR].map((d) => join(rootDir, d));
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      errors.push({ file: toRelative(dir), message: "ディレクトリがありません" });
    }
  }
  if (errors.length > 0) return { checkedFiles: [], errors };

  const [knowledgeDir, scenarioDir] = dirs as [string, string];
  for (const dir of dirs) {
    for (const file of listContentFiles(dir).yml) {
      errors.push({ file, message: "拡張子は .yaml にしてください (.yml は使わない)" });
    }
  }

  const knowledge = loadKnowledgeDir(knowledgeDir);
  const scenarios = loadScenarioDir(scenarioDir);
  errors.push(...knowledge.errors, ...scenarios.errors);

  errors.push(...checkFileLevel(knowledge, checkKnowledgeIntegrity));
  errors.push(...checkFileLevel(scenarios, checkScenarioIntegrity));
  errors.push(...checkIdMatchesFileName(knowledge));
  errors.push(...checkUniqueIds(knowledge, "知見"));
  errors.push(...checkUniqueIds(scenarios, "シナリオ"));
  errors.push(...checkScenarioRefs(knowledge, scenarios));

  return {
    checkedFiles: [...knowledge.files, ...scenarios.files].map(toRelative),
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

function checkIdMatchesFileName(result: LoadDirResult<Knowledge>): ContentError[] {
  return result.entries
    .filter(({ file, data }) => data.id !== getFileStem(file))
    .map(({ file, data, locateLine }) => ({
      file,
      line: locateLine(["id"]),
      message: `id とファイル名が一致しません: id=${data.id}, ファイル名=${getFileStem(file)}`,
    }));
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

// シナリオから知見への参照を検査する
function checkScenarioRefs(
  knowledge: LoadDirResult<Knowledge>,
  scenarios: LoadDirResult<Scenario>,
): ContentError[] {
  const errors: ContentError[] = [];
  const byId = new Map(knowledge.entries.map((e) => [e.data.id, e.data]));

  for (const { file, data, locateLine } of scenarios.entries) {
    const k = byId.get(data.event_type);
    if (!k) {
      errors.push({
        file,
        line: locateLine(["event_type"]),
        message: `event_type が知見の id に存在しません: ${data.event_type}`,
      });
      continue;
    }

    const phaseIds = new Set(k.phases.map((p) => p.id));
    const signalIds = new Set(k.phases.flatMap((p) => p.signals.map((s) => s.id)));

    data.expectations.forEach((e, i) => {
      if (e.phase !== undefined && !phaseIds.has(e.phase)) {
        errors.push({
          file,
          line: locateLine(["expectations", i, "phase"]),
          message: `expectations[${i}].phase が知見 ${k.id} の phase に存在しません: ${e.phase}`,
        });
      }
      (e.evidence_includes ?? []).forEach((signal, j) => {
        if (signalIds.has(signal)) return;
        errors.push({
          file,
          line: locateLine(["expectations", i, "evidence_includes", j]),
          message: `expectations[${i}].evidence_includes が知見 ${k.id} の signal に存在しません: ${signal}`,
        });
      });
    });
  }

  return errors;
}

// 雛形とスキーマのキー構造を突き合わせる。値は見ない
export function checkTemplateConformance(rootDir: string): TemplateConformance[] {
  const targets = [
    { file: `${KNOWLEDGE_DIR}/_template.yaml`, schema: KnowledgeSchema },
    { file: `${SCENARIO_DIR}/_template.yaml`, schema: ScenarioSchema },
  ];

  return targets.map(({ file, schema }) => {
    const path = join(rootDir, file);
    if (!existsSync(path)) return { file, errors: ["雛形がありません"] };

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

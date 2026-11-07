import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

// scenarios/ の模型を一時ディレクトリに作る

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export function readFixtureText(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
}

export function createContentRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "schema-content-"));
  mkdirSync(join(root, "scenarios"));
  return root;
}

export function removeContentRoot(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

export function writeContentFile(root: string, path: string, text: string): void {
  writeFileSync(join(root, path), text);
}

// 合格するシナリオを 1 件置く
export function writeValidScenario(root: string): void {
  writeContentFile(root, "scenarios/sample_scenario.yaml", readFixtureText("scenario.valid.yaml"));
}

// YAML を読み、指定パスの値を差し替えた文字列を返す。value が undefined なら削除する
export function editYaml(text: string, path: (string | number)[], value: unknown): string {
  const doc = parseDocument(text);
  if (value === undefined) doc.deleteIn(path);
  else doc.setIn(path, value);
  return doc.toString();
}

// 本物の雛形を模型に写す
export function copyRealTemplates(root: string): void {
  copyFileSync(
    join(REPO_ROOT, "scenarios", "_template.yaml"),
    join(root, "scenarios", "_template.yaml"),
  );
}

export function readRealTemplate(dir: "scenarios"): string {
  return readFileSync(join(REPO_ROOT, dir, "_template.yaml"), "utf8");
}

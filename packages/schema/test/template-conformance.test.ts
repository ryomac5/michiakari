import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkTemplateConformance } from "../src/validate-content.ts";
import {
  copyRealTemplates,
  createContentRoot,
  editYaml,
  REPO_ROOT,
  readRealTemplate,
  removeContentRoot,
  writeContentFile,
} from "./fixtures/content-root.ts";

let root: string;

beforeEach(() => {
  root = createContentRoot();
  copyRealTemplates(root);
});

afterEach(() => {
  removeContentRoot(root);
});

function errorsOf(file: string): string[] {
  return checkTemplateConformance(root).find((t) => t.file === file)?.errors ?? [];
}

describe("checkTemplateConformance", () => {
  it("本物の雛形が合格する", () => {
    expect(checkTemplateConformance(REPO_ROOT)).toEqual([
      { file: "knowledge/_template.yaml", errors: [] },
      { file: "scenarios/_template.yaml", errors: [] },
    ]);
  });

  it("スキーマに無いキーを足すと失敗する", () => {
    writeContentFile(
      root,
      "knowledge/_template.yaml",
      editYaml(readRealTemplate("knowledge"), ["phases", 0, "signals", 0, "severity"], "TODO"),
    );
    expect(errorsOf("knowledge/_template.yaml")).toEqual([
      "phases[0].signals[0].severity: スキーマに無いキーです",
    ]);
  });

  it("スカラーの位置に入れ子のキーを足すと失敗する", () => {
    writeContentFile(
      root,
      "scenarios/_template.yaml",
      editYaml(readRealTemplate("scenarios"), ["operator"], { ja: "TODO" }),
    );
    expect(errorsOf("scenarios/_template.yaml")).toEqual(["operator.ja: スキーマに無いキーです"]);
  });

  it("必須キーを消すと失敗する", () => {
    writeContentFile(
      root,
      "scenarios/_template.yaml",
      editYaml(
        readRealTemplate("scenarios"),
        ["user", "constraints", "knows_alternatives"],
        undefined,
      ),
    );
    expect(errorsOf("scenarios/_template.yaml")).toEqual([
      "user.constraints.knows_alternatives: スキーマの必須キーが雛形にありません",
    ]);
  });

  it("配列要素の必須キーを消すと失敗する", () => {
    writeContentFile(
      root,
      "knowledge/_template.yaml",
      editYaml(readRealTemplate("knowledge"), ["phases", 1, "guidance"], undefined),
    );
    expect(errorsOf("knowledge/_template.yaml")).toEqual([
      "phases[1].guidance: スキーマの必須キーが雛形にありません",
    ]);
  });

  it("任意キーは消しても合格する", () => {
    writeContentFile(
      root,
      "scenarios/_template.yaml",
      editYaml(readRealTemplate("scenarios"), ["expectations", 0, "action"], undefined),
    );
    expect(errorsOf("scenarios/_template.yaml")).toEqual([]);
  });

  it("任意キーを足しても合格する", () => {
    writeContentFile(
      root,
      "scenarios/_template.yaml",
      editYaml(readRealTemplate("scenarios"), ["weather"], { readings: [] }),
    );
    expect(errorsOf("scenarios/_template.yaml")).toEqual([]);
  });

  it("雛形が無ければ失敗する", () => {
    removeContentRoot(root);
    root = createContentRoot();
    expect(errorsOf("knowledge/_template.yaml")).toEqual(["雛形がありません"]);
  });
});

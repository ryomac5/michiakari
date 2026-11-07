import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatContentError, validateContent } from "../src/validate-content.ts";
import {
  createContentRoot,
  editYaml,
  readFixtureText,
  removeContentRoot,
  writeContentFile,
  writeValidScenario,
} from "./fixtures/content-root.ts";

let root: string;

beforeEach(() => {
  root = createContentRoot();
});

afterEach(() => {
  removeContentRoot(root);
});

const scenarioText = () => readFixtureText("scenario.valid.yaml");

function messagesOf(): string[] {
  return validateContent(root).errors.map(formatContentError);
}

describe("validateContent", () => {
  it("0 件のとき checkedFiles が空でエラーも無い", () => {
    expect(validateContent(root)).toEqual({ checkedFiles: [], errors: [] });
  });

  it("合格例を受け付け、検証したファイルを返す", () => {
    writeValidScenario(root);
    const result = validateContent(root);
    expect(result.errors).toEqual([]);
    expect(result.checkedFiles).toEqual(["scenarios/sample_scenario.yaml"]);
  });

  it("_ で始まるファイルと .md は対象外", () => {
    writeContentFile(root, "scenarios/_template.yaml", "id: TODO\n");
    writeContentFile(root, "scenarios/_draft.yaml", "broken: [\n");
    writeContentFile(root, "scenarios/README.md", "# TODO\n");
    expect(validateContent(root)).toEqual({ checkedFiles: [], errors: [] });
  });

  it("ディレクトリが無ければエラー", () => {
    removeContentRoot(root);
    expect(validateContent(root).errors).toEqual([
      { file: "scenarios", message: "ディレクトリがありません" },
    ]);
  });

  it("スキーマ違反を行番号つきで返す", () => {
    writeValidScenario(root);
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(scenarioText(), ["timeline", 1, "offset_minutes"], "十分"),
    );
    const { errors } = validateContent(root);
    const schemaError = errors.find((e) => e.message.startsWith("timeline.1.offset_minutes"));
    expect(schemaError?.file).toBe("scenarios/sample_scenario.yaml");
    expect(schemaError?.line).toBeTypeOf("number");
  });

  it("スキーマに無いキーを拒否する", () => {
    writeValidScenario(root);
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(scenarioText(), ["extra"], 1),
    );
    expect(
      messagesOf().some((m) => m.includes("scenarios/sample_scenario.yaml") && m.includes("extra")),
    ).toBe(true);
  });

  it("ファイル内の整合性違反を返す", () => {
    writeValidScenario(root);
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(scenarioText(), ["expectations", 1, "after"], "obs_9"),
    );
    expect(messagesOf()).toContain(
      "scenarios/sample_scenario.yaml: expectations.after が未定義の timeline id を指しています: obs_9",
    );
  });

  it("シナリオの id 重複を返す", () => {
    writeValidScenario(root);
    writeContentFile(root, "scenarios/copy.yaml", scenarioText());
    expect(messagesOf()).toContain(
      "scenarios/copy.yaml: シナリオの id が複数のファイルで重複しています: sample_scenario (copy.yaml, sample_scenario.yaml)",
    );
  });

  it("TODO の残った文字列値を返す", () => {
    writeValidScenario(root);
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(scenarioText(), ["ground_truth", "notes"], "TODO あとで書く"),
    );
    const { errors } = validateContent(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("TODO が残っています: TODO あとで書く");
    expect(errors[0]?.line).toBeTypeOf("number");
  });

  it("コメントの TODO は対象外", () => {
    writeValidScenario(root);
    writeContentFile(root, "scenarios/sample_scenario.yaml", `# TODO 見直す\n${scenarioText()}`);
    expect(validateContent(root).errors).toEqual([]);
  });

  it(".yml 拡張子を拒否する", () => {
    writeValidScenario(root);
    writeContentFile(root, "scenarios/extra.yml", scenarioText());
    const { errors, checkedFiles } = validateContent(root);
    expect(errors.map(formatContentError)).toEqual([
      "scenarios/extra.yml: 拡張子は .yaml にしてください (.yml は使わない)",
    ]);
    expect(checkedFiles).not.toContain("scenarios/extra.yml");
  });

  it("シナリオは知見を参照しないので、知見の無い event_type、phase、手がかりの id を受け付ける", () => {
    writeValidScenario(root);
    const edited = [
      [["event_type"], "person_collision"],
      [["expectations", 0, "phase"], "unknown_phase"],
      [["expectations", 0, "evidence_includes"], ["protection_received"]],
    ] as const;
    const text = edited.reduce((t, [path, value]) => editYaml(t, [...path], value), scenarioText());
    writeContentFile(root, "scenarios/sample_scenario.yaml", text);
    expect(messagesOf()).toEqual([]);
  });

  it("knowledge/ があっても検証しない", () => {
    writeValidScenario(root);
    mkdirSync(join(root, "knowledge"));
    writeContentFile(root, "knowledge/broken.yaml", "broken: [\n");
    const result = validateContent(root);
    expect(result.errors).toEqual([]);
    expect(result.checkedFiles).toEqual(["scenarios/sample_scenario.yaml"]);
  });

  it("重複キーを行番号つきで返す", () => {
    writeValidScenario(root);
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      `${scenarioText()}id: sample_scenario\n`,
    );
    const { errors } = validateContent(root);
    const duplicate = errors.find((e) => e.file === "scenarios/sample_scenario.yaml");
    expect(duplicate?.message).toContain("DUPLICATE_KEY");
    expect(duplicate?.line).toBeTypeOf("number");
  });
});

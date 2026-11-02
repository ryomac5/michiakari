import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatContentError, validateContent } from "../src/validate-content.ts";
import {
  createContentRoot,
  editYaml,
  readFixtureText,
  removeContentRoot,
  writeContentFile,
  writeValidPair,
} from "./fixtures/content-root.ts";

let root: string;

beforeEach(() => {
  root = createContentRoot();
});

afterEach(() => {
  removeContentRoot(root);
});

const knowledgeText = () => readFixtureText("knowledge.valid.yaml");
const scenarioText = () => readFixtureText("scenario.valid.yaml");

function messagesOf(): string[] {
  return validateContent(root).errors.map(formatContentError);
}

describe("validateContent", () => {
  it("0 件のとき checkedFiles が空でエラーも無い", () => {
    expect(validateContent(root)).toEqual({ checkedFiles: [], errors: [] });
  });

  it("合格例を受け付け、検証したファイルを返す", () => {
    writeValidPair(root);
    const result = validateContent(root);
    expect(result.errors).toEqual([]);
    expect(result.checkedFiles).toEqual([
      "knowledge/sample_event.yaml",
      "scenarios/sample_scenario.yaml",
    ]);
  });

  it("_ で始まるファイルと .md は対象外", () => {
    writeContentFile(root, "knowledge/_template.yaml", "id: TODO\n");
    writeContentFile(root, "scenarios/_draft.yaml", "broken: [\n");
    writeContentFile(root, "knowledge/README.md", "# TODO\n");
    expect(validateContent(root)).toEqual({ checkedFiles: [], errors: [] });
  });

  it("ディレクトリが無ければエラー", () => {
    removeContentRoot(root);
    expect(validateContent(root).errors.map((e) => e.message)).toEqual([
      "ディレクトリがありません",
      "ディレクトリがありません",
    ]);
  });

  it("スキーマ違反を行番号つきで返す", () => {
    writeValidPair(root);
    writeContentFile(
      root,
      "knowledge/sample_event.yaml",
      editYaml(knowledgeText(), ["phases", 0, "duration_minutes", "p50"], "十分"),
    );
    const { errors } = validateContent(root);
    const schemaError = errors.find((e) => e.message.startsWith("phases.0.duration_minutes.p50"));
    expect(schemaError?.file).toBe("knowledge/sample_event.yaml");
    expect(schemaError?.line).toBeTypeOf("number");
  });

  it("スキーマに無いキーを拒否する", () => {
    writeValidPair(root);
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
    writeValidPair(root);
    writeContentFile(
      root,
      "knowledge/sample_event.yaml",
      editYaml(knowledgeText(), ["phases", 1, "exit_signals"], ["missing_signal"]),
    );
    expect(messagesOf()).toContain(
      "knowledge/sample_event.yaml: phase working の exit_signals が未定義の signal を指しています: missing_signal",
    );
  });

  it("知見の id とファイル名の不一致を返す", () => {
    writeContentFile(root, "knowledge/other_name.yaml", knowledgeText());
    writeContentFile(root, "scenarios/sample_scenario.yaml", scenarioText());
    const { errors } = validateContent(root);
    expect(errors).toEqual([
      {
        file: "knowledge/other_name.yaml",
        line: 2,
        message: "id とファイル名が一致しません: id=sample_event, ファイル名=other_name",
      },
    ]);
  });

  it("知見の id 重複を返す", () => {
    writeValidPair(root);
    writeContentFile(root, "knowledge/sample_event_copy.yaml", knowledgeText());
    expect(
      messagesOf().some((m) =>
        m.includes("知見の id が複数のファイルで重複しています: sample_event"),
      ),
    ).toBe(true);
  });

  it("シナリオの id 重複を返す", () => {
    writeValidPair(root);
    writeContentFile(root, "scenarios/copy.yaml", scenarioText());
    expect(messagesOf()).toContain(
      "scenarios/copy.yaml: シナリオの id が複数のファイルで重複しています: sample_scenario (copy.yaml, sample_scenario.yaml)",
    );
  });

  it("TODO の残った文字列値を返す", () => {
    writeValidPair(root);
    writeContentFile(
      root,
      "knowledge/sample_event.yaml",
      editYaml(knowledgeText(), ["after_resume", "notes"], "TODO あとで書く"),
    );
    const { errors } = validateContent(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("TODO が残っています: TODO あとで書く");
    expect(errors[0]?.line).toBeTypeOf("number");
  });

  it("コメントの TODO は対象外", () => {
    writeValidPair(root);
    writeContentFile(root, "knowledge/sample_event.yaml", `# TODO 見直す\n${knowledgeText()}`);
    expect(validateContent(root).errors).toEqual([]);
  });

  it(".yml 拡張子を拒否する", () => {
    writeValidPair(root);
    writeContentFile(root, "scenarios/extra.yml", scenarioText());
    const { errors, checkedFiles } = validateContent(root);
    expect(errors.map(formatContentError)).toEqual([
      "scenarios/extra.yml: 拡張子は .yaml にしてください (.yml は使わない)",
    ]);
    expect(checkedFiles).not.toContain("scenarios/extra.yml");
  });

  it("event_type の参照切れを返す", () => {
    writeValidPair(root);
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(scenarioText(), ["event_type"], "unknown_event"),
    );
    expect(validateContent(root).errors).toEqual([
      {
        file: "scenarios/sample_scenario.yaml",
        line: 6,
        message: "event_type が知見の id に存在しません: unknown_event",
      },
    ]);
  });

  it("phase の参照切れを返す", () => {
    writeValidPair(root);
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(scenarioText(), ["expectations", 0, "phase"], "unknown_phase"),
    );
    expect(messagesOf()).toEqual([
      expect.stringMatching(
        /^scenarios\/sample_scenario\.yaml:\d+: expectations\[0\]\.phase が知見 sample_event の phase に存在しません: unknown_phase$/,
      ),
    ]);
  });

  it("evidence_includes の参照切れを返す", () => {
    writeValidPair(root);
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(
        scenarioText(),
        ["expectations", 0, "evidence_includes"],
        ["checking_announced", "unknown_signal"],
      ),
    );
    expect(messagesOf()).toEqual([
      expect.stringMatching(
        /^scenarios\/sample_scenario\.yaml:\d+: expectations\[0\]\.evidence_includes が知見 sample_event の signal に存在しません: unknown_signal$/,
      ),
    ]);
  });

  it("重複キーを行番号つきで返す", () => {
    writeValidPair(root);
    writeContentFile(root, "knowledge/sample_event.yaml", `${knowledgeText()}id: sample_event\n`);
    const { errors } = validateContent(root);
    const duplicate = errors.find((e) => e.file === "knowledge/sample_event.yaml");
    expect(duplicate?.message).toContain("DUPLICATE_KEY");
    expect(duplicate?.line).toBeTypeOf("number");
  });
});

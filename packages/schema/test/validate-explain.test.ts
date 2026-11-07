import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  describeYamlPath,
  type ExplainedContentError,
  explainContentErrors,
  formatContentError,
  formatExplainedError,
  sortContentErrors,
  validateContent,
} from "../src/validate-content.ts";
import {
  createContentRoot,
  editYaml,
  readFixtureText,
  readRealTemplate,
  removeContentRoot,
  writeContentFile,
  writeValidPair,
} from "./fixtures/content-root.ts";

// validate のエラーに添える説明と直し方を確かめる

let root: string;

beforeEach(() => {
  root = createContentRoot();
  writeValidPair(root);
});

afterEach(() => {
  removeContentRoot(root);
});

const knowledgeText = () => readFixtureText("knowledge.valid.yaml");
const scenarioText = () => readFixtureText("scenario.valid.yaml");

function explainAll(): ExplainedContentError[] {
  return explainContentErrors(root, validateContent(root).errors);
}

function findByMessage(prefix: string): ExplainedContentError | undefined {
  return explainAll().find((e) => e.message.startsWith(prefix));
}

describe("describeYamlPath", () => {
  it("配列の添字を 1 始まりの番号にして日本語の項目名でつなぐ", () => {
    expect(describeYamlPath(["phases", 0, "duration_minutes", "p50"])).toBe(
      "段階 1 › 所要時間 › 中央値 p50",
    );
    expect(describeYamlPath(["timeline", 2, "text", "ja"])).toBe("観測 3 › 文面 › 日本語");
    expect(describeYamlPath([])).toBe("ファイルの最上位");
  });
});

describe("explainContentErrors", () => {
  it("p50 が null なら中央値を分で書くよう促す", () => {
    writeContentFile(
      root,
      "knowledge/sample_event.yaml",
      editYaml(knowledgeText(), ["phases", 0, "duration_minutes", "p50"], null),
    );
    const e = findByMessage("phases.0.duration_minutes.p50");
    expect(e?.line).toBeTypeOf("number");
    expect(e?.explanation).toBe("「段階 1 › 所要時間 › 中央値 p50」が空です");
    expect(e?.hint).toBe("所要時間の中央値を分で書いてください。例: p50: 15");
  });

  it("p80 が p50 より小さければ理由と直し方を返す", () => {
    writeContentFile(
      root,
      "knowledge/sample_event.yaml",
      editYaml(knowledgeText(), ["phases", 0, "duration_minutes", "p80"], 5),
    );
    const e = findByMessage("phases.0.duration_minutes.p80");
    expect(e?.explanation).toBe(
      "「段階 1 › 所要時間 › 長引く場合 p80」が中央値 p50 より小さくなっています",
    );
    expect(e?.hint).toContain("p50 以上");
  });

  it("選べない値には候補を示す", () => {
    writeContentFile(
      root,
      "knowledge/sample_event.yaml",
      editYaml(knowledgeText(), ["phases", 0, "signals", 0, "observable_from", 0], "poster"),
    );
    const e = findByMessage("phases.0.signals.0.observable_from.0");
    expect(e?.explanation).toBe("「段階 1 › 兆候 1 › 情報源 1」が選べる値ではありません");
    expect(e?.hint).toContain("announcement、signage");
  });

  it("必須のキーが無ければ追加を促す", () => {
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(scenarioText(), ["ground_truth", "notes"], undefined),
    );
    const e = findByMessage("ground_truth.notes");
    expect(e?.explanation).toBe("「結末 › 補足」がありません。必須の項目です");
    expect(e?.hint).toMatch(/^キー notes を雛形どおりに追加してください。/);
  });

  it("スキーマに無いキーは綴りの確認を促す", () => {
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(scenarioText(), ["extra"], 1),
    );
    const e = findByMessage("(ルート)");
    expect(e?.explanation).toBe("「ファイルの最上位」にスキーマに無いキーがあります: extra");
    expect(e?.hint).toContain("綴り");
  });

  it("日時の形式違いに例を示す", () => {
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(scenarioText(), ["start_time"], "2026-11-05 22:40"),
    );
    const e = findByMessage("start_time");
    expect(e?.explanation).toBe("「開始時刻」が日時の形式ではありません");
    expect(e?.hint).toContain('"2026-11-05T22:40:00+09:00"');
  });

  it("TODO の場所を項目名で示す。同じ行の TODO も順に対応させる", () => {
    writeContentFile(
      root,
      "knowledge/sample_event.yaml",
      knowledgeText().replace("name: { ja: 対応中 }", "name: { ja: TODO, en: TODO }"),
    );
    const todos = explainAll().filter((e) => e.message.startsWith("TODO が残っています"));
    expect(todos.map((e) => e.explanation)).toEqual([
      "「段階 2 › 名前 › 日本語」が雛形のままです",
      "「段階 2 › 名前 › 英語」が雛形のままです",
    ]);
    expect(todos[0]?.hint).toBe("段階の名前を書いてください。例: 発生直後");
    expect(todos[1]?.hint).toBe("英語で書くか、不要なら行ごと消してください");
  });

  it("雛形をそのまま写すと、すべてのエラーに説明が付く", () => {
    writeContentFile(
      root,
      "knowledge/sample_event.yaml",
      readRealTemplate("knowledge").replace("id: TODO_event_id", "id: sample_event"),
    );
    const errors = explainAll().filter((e) => e.file === "knowledge/sample_event.yaml");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.filter((e) => !e.explanation || !e.hint)).toEqual([]);
  });

  it("exit_signals の未定義を signals への追加で直すよう促す", () => {
    writeContentFile(
      root,
      "knowledge/sample_event.yaml",
      editYaml(knowledgeText(), ["phases", 1, "exit_signals"], ["missing_signal"]),
    );
    const e = findByMessage("phase working の exit_signals");
    expect(e?.explanation).toBe(
      "段階 working の exit_signals にある missing_signal が、どの段階の signals にもありません",
    );
    expect(e?.hint).toContain("signals");
  });

  it("event_type の形式違反に、統計値の種類の id を書くよう案内する", () => {
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(scenarioText(), ["event_type"], "Person-Collision"),
    );
    const e = findByMessage("event_type");
    expect(e?.hint).toContain("統計値の種類の id");
  });

  it("YAML の構文エラーに確かめる点を示す", () => {
    writeContentFile(root, "scenarios/sample_scenario.yaml", "id: [broken\n");
    const e = findByMessage("YAML の解析に失敗しました");
    expect(e?.explanation).toBe("YAML として読めません");
    expect(e?.hint).toContain("インデント");
  });

  it("id とファイル名の不一致に両方の直し方を示す", () => {
    writeContentFile(root, "knowledge/other_name.yaml", knowledgeText());
    const e = findByMessage("id とファイル名が一致しません");
    expect(e?.hint).toBe(
      "ファイル名を sample_event.yaml に変えるか、id を other_name に直してください",
    );
  });
});

describe("formatExplainedError", () => {
  it("1 行目は従来の形式のまま、説明と直し方を字下げして続ける", () => {
    const e = {
      file: "knowledge/a.yaml",
      line: 3,
      message: "TODO が残っています: TODO",
      explanation: "「名前 › 日本語」が雛形のままです",
      hint: "事象の名前を書いてください。例: 人身事故",
    };
    expect(formatExplainedError(e, "  ")).toEqual([
      formatContentError(e),
      "  説明: 「名前 › 日本語」が雛形のままです",
      "  直し方: 事象の名前を書いてください。例: 人身事故",
    ]);
  });

  it("説明が無ければ 1 行だけ返す", () => {
    expect(formatExplainedError({ file: "x.yaml", message: "m" })).toEqual(["x.yaml: m"]);
  });
});

describe("sortContentErrors", () => {
  it("ファイル名、行番号の順に並べる", () => {
    const sorted = sortContentErrors([
      { file: "scenarios/s.yaml", line: 1, message: "c" },
      { file: "knowledge/k.yaml", line: 9, message: "b" },
      { file: "knowledge/k.yaml", line: 2, message: "a" },
    ]);
    expect(sorted.map((e) => e.message)).toEqual(["a", "b", "c"]);
  });
});

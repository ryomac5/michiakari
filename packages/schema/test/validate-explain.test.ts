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
  writeValidScenario,
} from "./fixtures/content-root.ts";

// validate のエラーに添える説明と直し方を確かめる

let root: string;

beforeEach(() => {
  root = createContentRoot();
  writeValidScenario(root);
});

afterEach(() => {
  removeContentRoot(root);
});

const scenarioText = () => readFixtureText("scenario.valid.yaml");

function explainAll(): ExplainedContentError[] {
  return explainContentErrors(root, validateContent(root).errors);
}

function findByMessage(prefix: string): ExplainedContentError | undefined {
  return explainAll().find((e) => e.message.startsWith(prefix));
}

describe("describeYamlPath", () => {
  it("配列の添字を 1 始まりの番号にして日本語の項目名でつなぐ", () => {
    expect(describeYamlPath(["expectations", 0, "evidence_includes", 1])).toBe(
      "期待 1 › 根拠の兆候 2",
    );
    expect(describeYamlPath(["timeline", 2, "text", "ja"])).toBe("観測 3 › 文面 › 日本語");
    expect(describeYamlPath([])).toBe("ファイルの最上位");
  });
});

describe("explainContentErrors", () => {
  it("空の値には、項目の書き方を示す", () => {
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(scenarioText(), ["timeline", 1, "offset_minutes"], null),
    );
    const e = findByMessage("timeline.1.offset_minutes");
    expect(e?.line).toBeTypeOf("number");
    expect(e?.explanation).toBe("「観測 2 › 経過分」が空です");
    expect(e?.hint).toBe("start_time からの経過を 0 以上の整数の分で書き、昇順に並べてください");
  });

  it("選べない値には候補を示す", () => {
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(scenarioText(), ["timeline", 0, "kind"], "poster"),
    );
    const e = findByMessage("timeline.0.kind");
    expect(e?.explanation).toBe("「観測 1 › 種類」が選べる値ではありません");
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
      "scenarios/sample_scenario.yaml",
      scenarioText().replace("text: { ja: 架空の放送 }", "text: { ja: TODO, en: TODO }"),
    );
    const todos = explainAll().filter((e) => e.message.startsWith("TODO が残っています"));
    expect(todos.map((e) => e.explanation)).toEqual([
      "「観測 2 › 文面 › 日本語」が雛形のままです",
      "「観測 2 › 文面 › 英語」が雛形のままです",
    ]);
    expect(todos[0]?.hint).toBe(
      "発表文や掲示の文面を自作して書いてください。実在の発表文は転載しません",
    );
    expect(todos[1]?.hint).toBe("英語で書くか、不要なら行ごと消してください");
  });

  it("雛形をそのまま写すと、すべてのエラーに説明が付く", () => {
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      readRealTemplate("scenarios").replace("id: TODO_scenario_id", "id: sample_scenario"),
    );
    const errors = explainAll().filter((e) => e.file === "scenarios/sample_scenario.yaml");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.filter((e) => !e.explanation || !e.hint)).toEqual([]);
  });

  it("expectations の after の未定義を timeline の id で直すよう促す", () => {
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(scenarioText(), ["expectations", 1, "after"], "obs_9"),
    );
    const e = findByMessage("expectations.after が未定義");
    expect(e?.explanation).toBe("expectations の after にある obs_9 が timeline にありません");
    expect(e?.hint).toContain("timeline");
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
});

describe("formatExplainedError", () => {
  it("1 行目は従来の形式のまま、説明と直し方を字下げして続ける", () => {
    const e = {
      file: "scenarios/a.yaml",
      line: 3,
      message: "TODO が残っています: TODO",
      explanation: "「題名 › 日本語」が雛形のままです",
      hint: "どんな状況かが分かる題名を書いてください",
    };
    expect(formatExplainedError(e, "  ")).toEqual([
      formatContentError(e),
      "  説明: 「題名 › 日本語」が雛形のままです",
      "  直し方: どんな状況かが分かる題名を書いてください",
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
      { file: "scenarios/k.yaml", line: 9, message: "b" },
      { file: "scenarios/k.yaml", line: 2, message: "a" },
    ]);
    expect(sorted.map((e) => e.message)).toEqual(["a", "b", "c"]);
  });
});

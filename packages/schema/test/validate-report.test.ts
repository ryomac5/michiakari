import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildValidationReport } from "../scripts/validate-report.ts";
import {
  createContentRoot,
  editYaml,
  REPO_ROOT,
  readFixtureText,
  removeContentRoot,
  writeContentFile,
  writeValidPair,
} from "./fixtures/content-root.ts";

// pnpm validate の出力と --watch を確かめる。本物の knowledge/ と scenarios/ には書かない

let root: string;

beforeEach(() => {
  root = createContentRoot();
  writeValidPair(root);
});

afterEach(() => {
  removeContentRoot(root);
});

describe("buildValidationReport", () => {
  it("合格なら従来どおりの行を出す", () => {
    const report = buildValidationReport(root, { isDefaultRoot: false });
    expect(report.ok).toBe(true);
    expect(report.lines).toEqual([
      `読み込み元: ${root}`,
      "検証したファイル: 2 件",
      "  - knowledge/sample_event.yaml",
      "  - scenarios/sample_scenario.yaml",
      "雛形の整合:",
      "  knowledge/_template.yaml: 雛形なし (CONTENT_DIR 指定のため省略)",
      "  scenarios/_template.yaml: 雛形なし (CONTENT_DIR 指定のため省略)",
      "エラーはありません",
    ]);
  });

  it("エラーの行は従来の形式で、その下に説明と直し方を続ける", () => {
    writeContentFile(
      root,
      "knowledge/sample_event.yaml",
      editYaml(
        readFixtureText("knowledge.valid.yaml"),
        ["phases", 0, "duration_minutes", "p50"],
        null,
      ),
    );
    const report = buildValidationReport(root, { isDefaultRoot: false });
    expect(report.ok).toBe(false);
    expect(report.lines.some((l) => /^エラー: \d+ 件$/.test(l))).toBe(true);
    const index = report.lines.findIndex((l) =>
      /^ {2}- knowledge\/sample_event\.yaml:\d+: phases\.0\.duration_minutes\.p50: /.test(l),
    );
    expect(index).toBeGreaterThan(0);
    expect(report.lines.slice(index + 1, index + 3)).toEqual([
      "      説明: 「段階 1 › 所要時間 › 中央値 p50」が空です",
      "      直し方: 所要時間の中央値を分で書いてください。例: p50: 15",
    ]);
  });

  it("エラーをファイル名と行番号の順に並べ、複数ファイルなら件数をまとめる", () => {
    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(readFixtureText("scenario.valid.yaml"), ["operator"], "TODO"),
    );
    writeContentFile(
      root,
      "knowledge/sample_event.yaml",
      editYaml(readFixtureText("knowledge.valid.yaml"), ["caveats", 0], "TODO"),
    );
    const { lines } = buildValidationReport(root, { isDefaultRoot: false });
    const errorLines = lines.filter((l) => l.startsWith("  - ") && l.includes("TODO"));
    expect(errorLines.map((l) => l.split(":")[0])).toEqual([
      "  - knowledge/sample_event.yaml",
      "  - scenarios/sample_scenario.yaml",
    ]);
    expect(lines.slice(-3)).toEqual([
      "ファイルごとの件数:",
      "  knowledge/sample_event.yaml: 1 件",
      "  scenarios/sample_scenario.yaml: 1 件",
    ]);
  });
});

describe("validate --watch", () => {
  let child: ChildProcess | undefined;

  afterEach(() => {
    child?.kill();
    child = undefined;
  });

  // 出力に pattern が count 回現れるまで待つ
  function waitForOutput(proc: ChildProcess, read: () => string, pattern: RegExp, count: number) {
    return new Promise<void>((resolve, reject) => {
      const check = () => {
        if ((read().match(new RegExp(pattern, "g")) ?? []).length >= count) resolve();
      };
      proc.stdout?.on("data", check);
      proc.on("exit", (code) => reject(new Error(`途中で終了しました: ${code}\n${read()}`)));
      check();
    });
  }

  it("変更を検出して検証し直す", async () => {
    let output = "";
    child = spawn(
      process.execPath,
      [join(REPO_ROOT, "packages/schema/scripts/validate.ts"), "--watch"],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, CONTENT_DIR: root },
      },
    );
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
    });
    const read = () => output;

    await waitForOutput(child, read, /監視中/, 1);
    expect(output).toContain("エラーはありません");

    writeContentFile(
      root,
      "scenarios/sample_scenario.yaml",
      editYaml(readFixtureText("scenario.valid.yaml"), ["operator"], "TODO"),
    );
    await waitForOutput(child, read, /監視中/, 2);
    expect(output).toContain("変更を検出したので検証し直します");
    expect(output).toMatch(/scenarios\/sample_scenario\.yaml:\d+: TODO が残っています/);
  }, 15_000);
});

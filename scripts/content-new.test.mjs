import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildNextSteps,
  ContentNewError,
  createContentFile,
  parseContentArgs,
  renderFromTemplate,
} from "./lib/content-new-core.mjs";

// 本物の knowledge/ と scenarios/ には書かず、一時ディレクトリの模型で確かめる

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readTemplate = (dir) => readFileSync(join(repoRoot, dir, "_template.yaml"), "utf8");

const createModel = () => {
  const rootDir = mkdtempSync(join(tmpdir(), "content-new-"));
  for (const dir of ["knowledge", "scenarios"]) {
    mkdirSync(join(rootDir, dir));
    copyFileSync(join(repoRoot, dir, "_template.yaml"), join(rootDir, dir, "_template.yaml"));
  }
  return rootDir;
};

describe("parseContentArgs", () => {
  test("knowledge は id だけを取る", () => {
    assert.deepEqual(parseContentArgs("knowledge", ["signal_failure"]), { id: "signal_failure" });
  });

  test("scenario は --event を取る。= で区切る書き方も受け付ける", () => {
    assert.deepEqual(parseContentArgs("scenario", ["rain_night", "--event", "heavy_rain"]), {
      id: "rain_night",
      eventId: "heavy_rain",
    });
    assert.deepEqual(parseContentArgs("scenario", ["--event=heavy_rain", "rain_night"]), {
      id: "rain_night",
      eventId: "heavy_rain",
    });
  });

  test("規則に合わない id や不足する引数を拒否する", () => {
    assert.throws(() => parseContentArgs("knowledge", ["Bad-Id"]), ContentNewError);
    assert.throws(() => parseContentArgs("knowledge", []), ContentNewError);
    assert.throws(() => parseContentArgs("knowledge", ["a", "b"]), ContentNewError);
    assert.throws(() => parseContentArgs("scenario", ["rain_night"]), /--event/);
    assert.throws(() => parseContentArgs("scenario", ["s", "--event", "X"]), ContentNewError);
    assert.throws(() => parseContentArgs("knowledge", ["a", "--force"]), /不明なオプション/);
  });
});

describe("renderFromTemplate", () => {
  test("知見の id を埋め、ほかは雛形のまま残す", () => {
    const template = readTemplate("knowledge");
    const text = renderFromTemplate("knowledge", template, { id: "signal_failure" });
    assert.match(text, /^id: signal_failure$/m);
    assert.doesNotMatch(text, /TODO_event_id/);
    assert.equal(text.split("\n").length, template.split("\n").length);
  });

  test("シナリオの id と event_type を埋め、行末のコメントは残す", () => {
    const text = renderFromTemplate("scenario", readTemplate("scenarios"), {
      id: "rain_night",
      eventId: "heavy_rain",
    });
    assert.match(text, /^id: rain_night$/m);
    assert.match(text, /^event_type: heavy_rain\s+# knowledge の id$/m);
  });

  test("置き換える行が無い雛形は失敗にする", () => {
    assert.throws(() => renderFromTemplate("knowledge", "id: x\n", { id: "a" }), ContentNewError);
  });
});

describe("createContentFile", () => {
  let rootDir;
  beforeEach(() => {
    rootDir = createModel();
  });
  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  test("雛形から新しいファイルを作る", () => {
    const { relPath } = createContentFile(rootDir, "scenario", {
      id: "rain_night",
      eventId: "heavy_rain",
    });
    assert.equal(relPath, "scenarios/rain_night.yaml");
    const text = readFileSync(join(rootDir, relPath), "utf8");
    assert.match(text, /^id: rain_night$/m);
    assert.match(text, /^event_type: heavy_rain/m);
  });

  test("既存のファイルは上書きしない", () => {
    const path = join(rootDir, "knowledge", "signal_failure.yaml");
    writeFileSync(path, "id: signal_failure\n");
    assert.throws(
      () => createContentFile(rootDir, "knowledge", { id: "signal_failure" }),
      /すでにあるので作りません/,
    );
    assert.equal(readFileSync(path, "utf8"), "id: signal_failure\n");
  });

  test("雛形が無ければ失敗にする", () => {
    rmSync(join(rootDir, "knowledge", "_template.yaml"));
    assert.throws(() => createContentFile(rootDir, "knowledge", { id: "a" }), /雛形がありません/);
  });
});

describe("buildNextSteps", () => {
  test("編集、validate、guard:approve の順に手順を示す", () => {
    const lines = buildNextSteps("knowledge", "knowledge/a.yaml", { branch: "main" }).join("\n");
    assert.ok(lines.indexOf("pnpm validate") < lines.indexOf("guard:approve"));
    assert.match(lines, /ALLOW_PROTECTED_EDIT=1 pnpm guard:approve/);
    assert.doesNotMatch(lines, /注意/);
  });

  test("知見が無いときと main 以外のブランチでは注意を出す", () => {
    const lines = buildNextSteps("scenario", "scenarios/s.yaml", {
      eventId: "heavy_rain",
      knowledgeExists: false,
      branch: "develop",
    }).join("\n");
    assert.match(lines, /pnpm knowledge:new heavy_rain/);
    assert.match(lines, /いまのブランチは develop/);
  });
});

describe("content-new.mjs", () => {
  const runCli = (args, env = {}) => {
    const { ALLOW_PROTECTED_EDIT: _omitted, ...base } = process.env;
    return spawnSync(process.execPath, [join(repoRoot, "scripts/content-new.mjs"), ...args], {
      encoding: "utf8",
      env: { ...base, ...env },
    });
  };

  test("ALLOW_PROTECTED_EDIT が無ければ何も書かずに拒否する", () => {
    const result = runCli(["knowledge", "tmp_content_new_test"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ALLOW_PROTECTED_EDIT=1 が設定されていないため拒否します/);
    assert.throws(() => readFileSync(join(repoRoot, "knowledge", "tmp_content_new_test.yaml")));
  });

  test("ALLOW_PROTECTED_EDIT があっても引数が不正なら書かずに失敗する", () => {
    const result = runCli(["scenario", "tmp_content_new_test"], { ALLOW_PROTECTED_EDIT: "1" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--event/);
    assert.throws(() => readFileSync(join(repoRoot, "scenarios", "tmp_content_new_test.yaml")));
  });
});

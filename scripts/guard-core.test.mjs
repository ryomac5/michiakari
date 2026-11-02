import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  checkApproval,
  checkBranchDiff,
  computeManifest,
  diffManifests,
  findSymlinks,
  formatManifest,
  hashFile,
  PROTECTED_DIRS,
  parseManifest,
  RECORD_FILE,
  readManifest,
  runValidate,
  writeManifest,
} from "./lib/guard-core.mjs";

const writeFile = (rootDir, rel, content) => {
  const path = join(rootDir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

// knowledge/ と scenarios/ の模型を作る
const createModel = () => {
  const rootDir = mkdtempSync(join(tmpdir(), "guard-core-"));
  writeFile(rootDir, "knowledge/a.yaml", "id: a\n");
  writeFile(rootDir, "knowledge/nested/b.yaml", "id: b\n");
  writeFile(rootDir, "scenarios/s1.yaml", "id: s1\n");
  return rootDir;
};

const approveAll = (rootDir) => {
  for (const name of PROTECTED_DIRS) {
    const dir = join(rootDir, name);
    writeManifest(dir, computeManifest(dir));
  }
};

const isAllOk = (rootDir) => checkApproval(rootDir).every((result) => result.ok);
const findResult = (rootDir, name) => checkApproval(rootDir).find((r) => r.name === name);

describe("承認記録の照合", () => {
  let rootDir;
  beforeEach(() => {
    rootDir = createModel();
  });
  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  test("記録が無ければ失敗する", () => {
    const results = checkApproval(rootDir);
    assert.equal(results.length, 2);
    for (const result of results) {
      assert.equal(result.ok, false);
      assert.equal(result.reason, "missing");
    }
  });

  test("片方だけ記録が無くても失敗する", () => {
    const dir = join(rootDir, "knowledge");
    writeManifest(dir, computeManifest(dir));
    assert.equal(findResult(rootDir, "knowledge").ok, true);
    assert.equal(findResult(rootDir, "scenarios").reason, "missing");
    assert.equal(isAllOk(rootDir), false);
  });

  test("内容が一致すれば合格する", () => {
    approveAll(rootDir);
    assert.equal(isAllOk(rootDir), true);
  });

  test("追加を検出する", () => {
    approveAll(rootDir);
    writeFile(rootDir, "knowledge/nested/deep/c.yaml", "id: c\n");
    const result = findResult(rootDir, "knowledge");
    assert.equal(result.ok, false);
    assert.deepEqual(result.diff.added, ["nested/deep/c.yaml"]);
  });

  test("削除を検出する", () => {
    approveAll(rootDir);
    unlinkSync(join(rootDir, "scenarios/s1.yaml"));
    const result = findResult(rootDir, "scenarios");
    assert.equal(result.ok, false);
    assert.deepEqual(result.diff.removed, ["s1.yaml"]);
  });

  test("内容の変更を検出する", () => {
    approveAll(rootDir);
    writeFile(rootDir, "knowledge/nested/b.yaml", "id: b2\n");
    const result = findResult(rootDir, "knowledge");
    assert.equal(result.ok, false);
    assert.deepEqual(result.diff.changed, ["nested/b.yaml"]);
    assert.deepEqual(result.diff.added, []);
    assert.deepEqual(result.diff.removed, []);
  });

  test(".DS_Store と記録ファイル自身は無視する", () => {
    writeFile(rootDir, "knowledge/.DS_Store", "x");
    writeFile(rootDir, "knowledge/nested/.DS_Store", "x");
    approveAll(rootDir);
    const manifest = computeManifest(join(rootDir, "knowledge"));
    assert.deepEqual([...manifest.keys()], ["a.yaml", "nested/b.yaml"]);
    writeFile(rootDir, "knowledge/.DS_Store", "changed");
    writeFile(rootDir, "scenarios/.DS_Store", "new");
    assert.equal(isAllOk(rootDir), true);
  });

  test("記録ファイルの改ざんを検出する", () => {
    approveAll(rootDir);
    writeFile(rootDir, `knowledge/${RECORD_FILE}`, "not a valid line\n");
    const result = findResult(rootDir, "knowledge");
    assert.equal(result.ok, false);
    assert.deepEqual(result.invalidLines, ["not a valid line"]);
  });
});

describe("記録の形式", () => {
  let rootDir;
  beforeEach(() => {
    rootDir = createModel();
  });
  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  test("パスでソートされた '<sha256>  <相対パス>' の行になる", () => {
    const dir = join(rootDir, "knowledge");
    writeFile(rootDir, "knowledge/0first.yaml", "z\n");
    const text = formatManifest(computeManifest(dir));
    const lines = text.trimEnd().split("\n");
    assert.deepEqual(
      lines.map((line) => line.slice(66)),
      ["0first.yaml", "a.yaml", "nested/b.yaml"],
    );
    assert.equal(lines[1], `${hashFile(join(dir, "a.yaml"))}  a.yaml`);
    assert.ok(text.endsWith("\n"));
  });

  test("書いた記録を読み戻すと同じ内容になる", () => {
    const dir = join(rootDir, "knowledge");
    const manifest = computeManifest(dir);
    writeManifest(dir, manifest);
    const record = readManifest(dir);
    assert.deepEqual(record.entries, manifest);
    assert.deepEqual(record.invalidLines, []);
    assert.deepEqual(parseManifest(formatManifest(manifest)).entries, manifest);
  });

  test("記録が無いときは null を返す", () => {
    assert.equal(readManifest(join(rootDir, "knowledge")), null);
  });

  test("shasum -a 256 -c で検証できる", () => {
    approveAll(rootDir);
    for (const name of PROTECTED_DIRS) {
      const result = spawnSync("shasum", ["-a", "256", "-c", RECORD_FILE], {
        cwd: join(rootDir, name),
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
  });

  test("diffManifests は追加・削除・変更を分ける", () => {
    const approved = new Map([
      ["keep", "1"],
      ["gone", "2"],
      ["edit", "3"],
    ]);
    const current = new Map([
      ["keep", "1"],
      ["edit", "4"],
      ["new", "5"],
    ]);
    assert.deepEqual(diffManifests(approved, current), {
      added: ["new"],
      removed: ["gone"],
      changed: ["edit"],
    });
  });
});

describe("シンボリックリンクの検出", () => {
  let rootDir;
  beforeEach(() => {
    rootDir = createModel();
  });
  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  test("無ければ空を返す", () => {
    assert.deepEqual(findSymlinks(rootDir), []);
  });

  test("ファイルとディレクトリへのリンクを検出し、走査対象から外す", () => {
    const outside = join(rootDir, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "x.yaml"), "x\n");
    symlinkSync(join(outside, "x.yaml"), join(rootDir, "knowledge/nested/link.yaml"));
    symlinkSync(outside, join(rootDir, "scenarios/linkdir"));
    assert.deepEqual(findSymlinks(rootDir), ["knowledge/nested/link.yaml", "scenarios/linkdir"]);
    assert.deepEqual([...computeManifest(join(rootDir, "scenarios")).keys()], ["s1.yaml"]);
  });
});

describe("ブランチ差分", () => {
  let rootDir;
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.com",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
    );

  const initRepo = (branch) => {
    git("init", "-q", "-b", branch);
    writeFile(rootDir, "README.md", "readme\n");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  };

  beforeEach(() => {
    rootDir = createModel();
  });
  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  test("git 管理外なら警告にする", () => {
    assert.equal(checkBranchDiff(rootDir).status, "warn");
    assert.equal(checkBranchDiff(rootDir).reason, "not-git");
  });

  test("main ref が無ければ警告にする", () => {
    initRepo("trunk");
    git("checkout", "-q", "-b", "feature");
    const result = checkBranchDiff(rootDir);
    assert.equal(result.status, "warn");
    assert.equal(result.reason, "no-base");
  });

  test("main 上では検査を飛ばす", () => {
    initRepo("main");
    writeFile(rootDir, "knowledge/a.yaml", "changed\n");
    assert.equal(checkBranchDiff(rootDir).status, "skip");
  });

  test("保護ディレクトリ外の変更だけなら合格する", () => {
    initRepo("main");
    git("checkout", "-q", "-b", "feature");
    writeFile(rootDir, "apps/x.ts", "x\n");
    git("add", "-A");
    git("commit", "-q", "-m", "feature");
    writeFile(rootDir, "README.md", "edited\n");
    assert.equal(checkBranchDiff(rootDir).status, "pass");
  });

  test("ブランチのコミットに含まれる変更を検出する", () => {
    initRepo("main");
    git("checkout", "-q", "-b", "feature");
    writeFile(rootDir, "knowledge/a.yaml", "changed\n");
    git("commit", "-q", "-am", "edit knowledge");
    const result = checkBranchDiff(rootDir);
    assert.equal(result.status, "fail");
    assert.deepEqual(result.files, ["knowledge/a.yaml"]);
  });

  test("未コミットの作業ツリーの変更を検出する", () => {
    initRepo("main");
    git("checkout", "-q", "-b", "feature");
    unlinkSync(join(rootDir, "scenarios/s1.yaml"));
    const result = checkBranchDiff(rootDir);
    assert.equal(result.status, "fail");
    assert.deepEqual(result.files, ["scenarios/s1.yaml"]);
  });

  test("ステージだけされた新規ファイルを検出する", () => {
    initRepo("main");
    git("checkout", "-q", "-b", "feature");
    writeFile(rootDir, "scenarios/new.yaml", "new\n");
    git("add", "scenarios/new.yaml");
    const result = checkBranchDiff(rootDir);
    assert.equal(result.status, "fail");
    assert.deepEqual(result.files, ["scenarios/new.yaml"]);
  });

  test("main が先に進んでいても分岐点から比較する", () => {
    initRepo("main");
    git("checkout", "-q", "-b", "feature");
    git("checkout", "-q", "main");
    writeFile(rootDir, "knowledge/a.yaml", "main edit\n");
    git("commit", "-q", "-am", "main edits knowledge");
    git("checkout", "-q", "feature");
    assert.equal(checkBranchDiff(rootDir).status, "pass");
  });
});

describe("validate の起動", () => {
  let rootDir;
  beforeEach(() => {
    rootDir = createModel();
  });
  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  test("CONTENT_DIR を子プロセスに引き継がない", () => {
    const script =
      "require('node:fs').writeFileSync('seen.txt', JSON.stringify([process.env.CONTENT_DIR ?? null, process.env.KEEP ?? null]))";
    writeFile(
      rootDir,
      "package.json",
      JSON.stringify({
        packageManager: JSON.parse(readFileSync("package.json", "utf8")).packageManager,
        scripts: { validate: `node -e "${script}"` },
      }),
    );
    const env = { ...process.env, CONTENT_DIR: "dummy/dir", KEEP: "yes" };
    assert.equal(runValidate(rootDir, { stdio: "ignore", env }), 0);
    assert.deepEqual(JSON.parse(readFileSync(join(rootDir, "seen.txt"), "utf8")), [null, "yes"]);
  });
});

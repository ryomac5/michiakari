import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findRepoRoot, resolveContentDir } from "../src/loaders.ts";
import {
  checkTemplateConformance,
  formatContentError,
  validateContent,
} from "../src/validate-content.ts";

// 開発用のダミー内容と、CONTENT_DIR による読み込み元の切り替え

const DEV_CONTENT_DIR = resolve(fileURLToPath(new URL("./fixtures/dev-content", import.meta.url)));

describe("開発用のダミー内容", () => {
  it("ダミーの知見は置かず、シナリオ 5 件がすべて検証を通る", () => {
    const result = validateContent(DEV_CONTENT_DIR);
    expect(result.errors.map(formatContentError)).toEqual([]);
    expect(existsSync(join(DEV_CONTENT_DIR, "knowledge"))).toBe(false);
    expect(result.checkedFiles).toEqual([
      "scenarios/heavy_rain_evening.yaml",
      "scenarios/in_car_response_loop.yaml",
      "scenarios/person_accident_last_train.yaml",
      "scenarios/protection_queue_kobe.yaml",
      "scenarios/vehicle_failure_short.yaml",
    ]);
  });

  it("雛形が無くても allowMissing なら失敗にしない", () => {
    expect(checkTemplateConformance(DEV_CONTENT_DIR, { allowMissing: true })).toEqual([
      { file: "knowledge/_template.yaml", errors: [], skipped: true },
      { file: "scenarios/_template.yaml", errors: [], skipped: true },
    ]);
  });
});

describe("findRepoRoot", () => {
  it("サブディレクトリから pnpm-workspace.yaml のある場所を返す", () => {
    const root = findRepoRoot();
    expect(existsSync(join(root, "pnpm-workspace.yaml"))).toBe(true);
    expect(findRepoRoot(DEV_CONTENT_DIR)).toBe(root);
    expect(findRepoRoot(join(root, "apps", "web"))).toBe(root);
  });

  it("見つからなければ例外を投げる", () => {
    const outside = mkdtempSync(join(tmpdir(), "no-repo-"));
    try {
      expect(() => findRepoRoot(outside)).toThrow("リポジトリルートが見つかりません");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("resolveContentDir", () => {
  const repoRoot = findRepoRoot();

  it("CONTENT_DIR が無ければリポジトリルートを返す", () => {
    expect(resolveContentDir({})).toBe(repoRoot);
    expect(resolveContentDir({ CONTENT_DIR: " " })).toBe(repoRoot);
  });

  it("相対パスはリポジトリルート基準で解決する", () => {
    expect(resolveContentDir({ CONTENT_DIR: "packages/schema/test/fixtures/dev-content" })).toBe(
      DEV_CONTENT_DIR,
    );
  });

  it("絶対パスはそのまま使う", () => {
    expect(resolveContentDir({ CONTENT_DIR: DEV_CONTENT_DIR })).toBe(DEV_CONTENT_DIR);
  });

  it("process.env をそのまま渡せる", () => {
    expect(resolveContentDir(process.env)).toBeTypeOf("string");
  });
});

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, resolveContentDir } from "../src/loaders.ts";
import {
  checkTemplateConformance,
  formatContentError,
  validateContent,
} from "../src/validate-content.ts";

// 開発用のダミー内容と、CONTENT_DIR による読み込み元の切り替え

const DEV_CONTENT_DIR = resolve(fileURLToPath(new URL("./fixtures/dev-content", import.meta.url)));

describe("開発用のダミー内容", () => {
  it("知見 3 件とシナリオ 3 件がすべて検証を通る", () => {
    const result = validateContent(DEV_CONTENT_DIR);
    expect(result.errors.map(formatContentError)).toEqual([]);
    expect(result.checkedFiles).toEqual([
      "knowledge/heavy_rain.yaml",
      "knowledge/person_accident.yaml",
      "knowledge/vehicle_failure.yaml",
      "scenarios/heavy_rain_evening.yaml",
      "scenarios/person_accident_last_train.yaml",
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

describe("resolveContentDir", () => {
  it("CONTENT_DIR が無ければリポジトリルートを返す", () => {
    expect(resolveContentDir({})).toBe(REPO_ROOT);
    expect(resolveContentDir({ CONTENT_DIR: " " })).toBe(REPO_ROOT);
  });

  it("相対パスはリポジトリルート基準で解決する", () => {
    expect(resolveContentDir({ CONTENT_DIR: "packages/schema/test/fixtures/dev-content" })).toBe(
      DEV_CONTENT_DIR,
    );
  });

  it("絶対パスはそのまま使う", () => {
    expect(resolveContentDir({ CONTENT_DIR: DEV_CONTENT_DIR })).toBe(DEV_CONTENT_DIR);
  });
});

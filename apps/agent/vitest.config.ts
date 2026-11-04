import { defineConfig } from "vitest/config";

// agent のテストは、ダミーのシナリオを HTTP の入口から通して全観測を判断する
// turbo が全パッケージのテストを並べて走らせると 1 件が既定の 5 秒を超えることがあるので、上限を延ばす
export default defineConfig({
  test: {
    testTimeout: 20_000,
  },
});

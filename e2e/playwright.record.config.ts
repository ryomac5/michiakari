import { defineConfig } from "@playwright/test";
import { buildWebServers, webUrl } from "./servers.ts";

// デモ動画の録画用。pnpm --filter e2e record で動かす。CI の test には含めない
// 動画は recordings/<テスト名>/video.webm に出る（git 管理外）

export default defineConfig({
  testDir: "./record",
  outputDir: "./recordings",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 10 * 60_000,
  use: {
    browserName: "chromium",
    baseURL: webUrl,
    // スマートフォンの縦画面
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    video: { mode: "on", size: { width: 390, height: 844 } },
    colorScheme: "dark",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
  // 録画は本物の地図タイルとフォントで撮る
  webServer: buildWebServers({ stubExternal: false }),
});

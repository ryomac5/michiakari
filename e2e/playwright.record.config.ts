import { defineConfig } from "@playwright/test";
import { buildWebServers, webUrl } from "./servers.ts";

// デモ動画の録画用。pnpm --filter e2e record で動かす。CI の test には含めない
// 動画は recordings/<テスト名>/video.webm に出る（git 管理外）

// 録画の色。画面は端末の設定ではなく cookie の theme で色を決めるので、両方をそろえる
// RECORD_THEME=light で明るい画面でも撮れる
const recordTheme = process.env.RECORD_THEME === "light" ? "light" : "dark";

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
    colorScheme: recordTheme,
    storageState: {
      cookies: [
        {
          name: "theme",
          value: recordTheme,
          domain: new URL(webUrl).hostname,
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
  // 録画は本物の地図タイルとフォントで撮る。フォントの取得で初回のコンパイルが長いので、起動待ちを延ばす
  webServer: buildWebServers({ stubExternal: false, webStartTimeoutMs: 5 * 60_000 }),
});

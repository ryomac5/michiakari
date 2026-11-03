import { fileURLToPath } from "node:url";
import type { PlaywrightTestConfig } from "@playwright/test";

// e2e と録画で共有するサーバー設定
// agent は決定論モードとダミーの内容で起動し、web はモックを使わずその agent に向ける
// 既存のモックを使うテストは URL の ?mock=1 で個別に切り替える

const webPort = Number(process.env.E2E_WEB_PORT ?? 3000);
const agentPort = Number(process.env.E2E_AGENT_PORT ?? 8787);

export const webUrl = `http://localhost:${webPort}`;
export const agentUrl = `http://localhost:${agentPort}`;
// リポジトリルートからの相対パス。agent と web はどちらもルート基準で解決する
export const contentDir = "packages/schema/test/fixtures/dev-content";

// 外部のタイルとフォントを固定データに差し替えるか。E2E_REAL_TILES=1 なら本物を取りに行く
// 録画は playwright.record.config.ts で常に本物を使う
export const stubExternal = process.env.E2E_REAL_TILES !== "1";

// next/font/google の取得を固定の応答に差し替える。e2e/fixtures/fonts/google-fonts.cjs を読ませる
const fontMockPath = fileURLToPath(new URL("./fixtures/fonts/google-fonts.cjs", import.meta.url));

// web の起動待ちの既定。本物のフォントを取る録画では、record の設定で延ばす
const defaultWebStartTimeoutMs = 120_000;

export const webCommand = `pnpm --filter @repo/web exec next dev --port ${webPort}`;

export function buildWebEnv(options: { stubExternal: boolean }): Record<string, string> {
  const fontEnv: Record<string, string> = options.stubExternal
    ? { NEXT_FONT_GOOGLE_MOCKED_RESPONSES: fontMockPath }
    : {};
  return { CONTENT_DIR: contentDir, NEXT_PUBLIC_AGENT_URL: agentUrl, ...fontEnv };
}

export function buildWebServers(options: {
  stubExternal: boolean;
  webStartTimeoutMs?: number;
}): NonNullable<PlaywrightTestConfig["webServer"]> {
  return [
    {
      command: webCommand,
      env: buildWebEnv(options),
      url: webUrl,
      reuseExistingServer: !process.env.CI,
      timeout: options.webStartTimeoutMs ?? defaultWebStartTimeoutMs,
    },
    {
      command: "pnpm --filter @repo/agent start",
      env: {
        JUDGE_MODE: "deterministic",
        CONTENT_DIR: contentDir,
        PORT: String(agentPort),
        CORS_ORIGINS: webUrl,
        // リプレイは観測ごとに要求を送るので、頻度制限に掛からないようにする
        RATE_LIMIT_PER_MINUTE: "10000",
      },
      url: `${agentUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ];
}

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

export const webServers: NonNullable<PlaywrightTestConfig["webServer"]> = [
  {
    command: `pnpm --filter @repo/web exec next dev --port ${webPort}`,
    env: { CONTENT_DIR: contentDir, NEXT_PUBLIC_AGENT_URL: agentUrl },
    url: webUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
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

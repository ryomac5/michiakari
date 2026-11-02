import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// サーバー関数が実行時に fs で読むファイル。パスはこのファイルからの相対
// findRepoRoot が pnpm-workspace.yaml を目印にするので、それも同梱する
const runtimeContentFiles = [
  "../../pnpm-workspace.yaml",
  "../../knowledge/**/*",
  "../../scenarios/**/*",
  "../../packages/schema/test/fixtures/dev-content/**/*",
  "../../packages/geo/data/**/*",
];

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/schema", "@repo/core", "@repo/geo"],
  // next dev が AGENTS.md を自動生成しないようにする
  agentRules: false,
  // 録画とスクリーンショットに開発用の表示を写さない
  devIndicators: false,
  // @repo/geo の路線データ（.geojson）を JSON として読み込む
  turbopack: { rules: { "*.geojson": { type: "json" } } },
  // Vercel のサーバー関数に知見・シナリオ・路線データを同梱する
  outputFileTracingIncludes: { "/**/*": runtimeContentFiles },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);

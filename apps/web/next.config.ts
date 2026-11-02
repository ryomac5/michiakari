import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/schema", "@repo/core", "@repo/geo", "@repo/data"],
  // next dev が AGENTS.md を自動生成しないようにする
  agentRules: false,
  // 録画とスクリーンショットに開発用の表示を写さない
  devIndicators: false,
  // @repo/geo の路線データ（.geojson）を JSON として読み込む
  turbopack: { rules: { "*.geojson": { type: "json" } } },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);

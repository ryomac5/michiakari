import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/schema", "@repo/core", "@repo/geo", "@repo/data"],
  // next dev が AGENTS.md を自動生成しないようにする
  agentRules: false,
};

export default nextConfig;

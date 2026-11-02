import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createGeoProvider } from "./alternatives/geo-provider.ts";
import { createApp } from "./app.ts";
import {
  defaultPort,
  resolveCorsOrigins,
  resolveJudgeMode,
  resolveRateLimitPerWindow,
} from "./config.ts";
import { loadContentStore } from "./content.ts";
import { createAnthropicLlmClient } from "./llm-client.ts";
import { loadPrompts } from "./prompts/load-prompts.ts";
import { createAmedasRainFetcher } from "./tools/jma-amedas.ts";

// 起動時に知見とシナリオを読み、判断モードを決めてサーバーを立てる

const port = Number(process.env.PORT ?? defaultPort);
const mode = resolveJudgeMode();
const content = loadContentStore();

const app = createApp({
  judge: {
    mode,
    content,
    provider: createGeoProvider(),
    fetchRain: createAmedasRainFetcher(),
    llm: mode === "claude" ? createAnthropicLlmClient() : null,
    prompts: loadPrompts(),
    logWarning: (message) => console.warn(message),
  },
  corsOrigins: resolveCorsOrigins(),
  rateLimitPerWindow: resolveRateLimitPerWindow(),
  resolveClientKey: (c) =>
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    getConnInfo(c).remote.address ||
    "anonymous",
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `agent listening on http://localhost:${info.port} (mode: ${mode}, knowledge: ${content.knowledge.size}, scenarios: ${content.scenarios.size}, content errors: ${content.errorCount})`,
  );
});

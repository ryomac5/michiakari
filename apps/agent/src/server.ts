import { serve } from "@hono/node-server";
import { createGeoProvider } from "./alternatives/geo-provider.ts";
import { createApp } from "./app.ts";
import {
  defaultPort,
  resolveCorsOrigins,
  resolveJudgeMode,
  resolveRateLimitPerWindow,
  resolveTrustProxy,
} from "./config.ts";
import { loadContentStore } from "./content.ts";
import { createAnthropicLlmClient } from "./llm-client.ts";
import { loadPrompts } from "./prompts/load-prompts.ts";
import { createAmedasRainFetcher } from "./tools/jma-amedas.ts";

// 起動時にシナリオを読み、判断モードを決めてサーバーを立てる

const port = Number(process.env.PORT ?? defaultPort);
const mode = resolveJudgeMode();
const content = loadContentStore();

const app = createApp({
  judge: {
    mode,
    content,
    provider: createGeoProvider(),
    fetchRain: createAmedasRainFetcher(fetch, (message) => console.warn(message)),
    llm: mode === "claude" ? createAnthropicLlmClient() : null,
    prompts: loadPrompts(),
    logWarning: (message) => console.warn(message),
  },
  corsOrigins: resolveCorsOrigins(),
  rateLimitPerWindow: resolveRateLimitPerWindow(),
  trustProxy: resolveTrustProxy(),
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `agent listening on http://localhost:${info.port} (mode: ${mode}, scenarios: ${content.scenarios.size}, content errors: ${content.errorCount})`,
  );
});

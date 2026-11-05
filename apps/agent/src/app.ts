import { IdSchema, type JudgeRequest, JudgeRequestSchema, JudgmentEventSchema } from "@repo/schema";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createGeoProvider } from "./alternatives/geo-provider.ts";
import { safetyLimits } from "./config.ts";
import type { ContentStore } from "./content.ts";
import { createEventSink } from "./judge/event-sink.ts";
import { type JudgeDeps, runJudge } from "./judge/run-judge.ts";
import { loadPrompts } from "./prompts/load-prompts.ts";
import { createRateLimiter, resolveClientKey } from "./rate-limit.ts";

// HTTP の入口。リクエストの検証、上限、CORS、SSE を受け持つ

export type AppOptions = {
  judge: JudgeDeps;
  corsOrigins: string[];
  rateLimitPerWindow: number;
  // X-Forwarded-For を頻度制限の単位に使うか。既定は接続元アドレス
  trustProxy?: boolean;
  // サーバー時計の読み取り。頻度制限にだけ使い、判断には使わない
  readClockMs?: () => number;
};

const EMPTY_CONTENT: ContentStore = { knowledge: new Map(), scenarios: new Map(), errorCount: 0 };

// テストや骨組み確認用の既定値。判断は決定論モードで動く
export function createDefaultJudgeDeps(): JudgeDeps {
  return {
    mode: "deterministic",
    content: EMPTY_CONTENT,
    provider: createGeoProvider(),
    fetchRain: async () => null,
    llm: null,
    prompts: loadPrompts(),
    logWarning: () => {},
  };
}

function estimateBase64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

// スキーマの外にある上限を検査する
function checkRequestLimits(request: JudgeRequest): string | null {
  if (request.observations.length > safetyLimits.maxObservations) {
    return `観測は ${safetyLimits.maxObservations} 件までです`;
  }
  if (
    request.newInput?.type === "photo" &&
    estimateBase64Bytes(request.newInput.imageBase64) > safetyLimits.maxImageBytes
  ) {
    return `画像は ${safetyLimits.maxImageBytes / 1024 / 1024}MB までです`;
  }
  return null;
}

// エラーを 1 件だけ流す SSE。判断の前に失敗したときに使う
function respondWithError(
  c: Context,
  status: 400 | 413 | 429 | 500,
  message: string,
  retryable: boolean,
) {
  c.status(status);
  return streamSSE(c, async (stream) => {
    const event = JudgmentEventSchema.parse({
      type: "error",
      seq: 0,
      at: new Date().toISOString(),
      message,
      retryable,
    });
    await stream.writeSSE({ event: event.type, id: "0", data: JSON.stringify(event) });
  });
}

export function createApp(
  options: AppOptions = {
    judge: createDefaultJudgeDeps(),
    corsOrigins: ["http://localhost:3000"],
    rateLimitPerWindow: 20,
  },
) {
  const app = new Hono();
  const limiter = createRateLimiter(options.rateLimitPerWindow, safetyLimits.rateLimitWindowMs);
  const trustProxy = options.trustProxy ?? false;
  const readClockMs = options.readClockMs ?? Date.now;

  app.use("*", cors({ origin: options.corsOrigins, allowMethods: ["GET", "POST", "OPTIONS"] }));
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.post(
    "/judge",
    bodyLimit({
      maxSize: safetyLimits.maxRequestBytes,
      onError: (c) => respondWithError(c, 413, "リクエストが大きすぎます", false),
    }),
    async (c) => {
      if (!limiter.consume(resolveClientKey(c, trustProxy), readClockMs())) {
        return respondWithError(
          c,
          429,
          "リクエストが多すぎます。しばらくしてから再試行してください",
          true,
        );
      }
      const body: unknown = await c.req.json().catch(() => null);
      const parsed = JudgeRequestSchema.safeParse(body);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(" / ");
        return respondWithError(c, 400, `リクエストが不正です: ${issues}`, false);
      }
      const limitError = checkRequestLimits(parsed.data);
      if (limitError) return respondWithError(c, 413, limitError, false);

      const scenarioQuery = IdSchema.safeParse(c.req.query("scenarioId"));
      const request = parsed.data;
      return streamSSE(c, async (stream) => {
        // 利用者が切断したら、Claude の呼び出しと判断ループを止める
        const controller = new AbortController();
        stream.onAbort(() => controller.abort());
        const sink = createEventSink(
          (event) =>
            stream.writeSSE({
              event: event.type,
              id: String(event.seq),
              data: JSON.stringify(event),
            }),
          () => request.now,
        );
        try {
          await runJudge(
            request,
            {
              scenarioId: scenarioQuery.success ? scenarioQuery.data : null,
              signal: controller.signal,
            },
            options.judge,
            sink,
          );
        } catch (error) {
          if (controller.signal.aborted) return;
          options.judge.logWarning(
            `判断に失敗しました: ${error instanceof Error ? error.name : "unknown"}`,
          );
          await sink.emit({
            type: "error",
            message: "判断に失敗しました。再試行してください",
            retryable: true,
          });
        }
      });
    },
  );

  return app;
}

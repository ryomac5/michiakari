// 設定はここ1か所で管理する。モデル名もここに置く

export const models = {
  judgment: "claude-opus-5-5",
  interpretation: "claude-haiku-5-5",
} as const;

const MAX_TOOL_CALLS = 12;

// 判断ループと解釈の呼び出し設定
export const claudeSettings = {
  judgmentEffort: "medium",
  interpretationEffort: "low",
  // 非ストリーミングで呼ぶので、SDK が長時間の応答としてストリーミングを求める上限（約 21,000）より小さく保つ
  judgmentMaxTokens: 16000,
  interpretationMaxTokens: 4000,
  // 判断ループで許すツール呼び出しの上限。超えたら決定論モードで仕上げる
  maxToolCalls: MAX_TOOL_CALLS,
  // 判断ループの反復の上限。ツールを呼ばない応答（促し・pause_turn）が続いても止める
  maxLoopIterations: MAX_TOOL_CALLS + 4,
  // emit_judgment の検証に失敗したときに許す再生成の回数
  maxRegenerations: 1,
  // 拒否されたときにサーバー側で別モデルに回す
  fallbackBeta: "server-side-fallback-2026-07-01",
  // ツール呼び出しの合間の進捗メモ（thinking.display: "updates"）
  thinkingUpdatesBeta: "thinking-display-updates-2026-08-18",
  thinkingDisplay: "updates",
  // SDK のタイムアウト（ミリ秒）と再試行の回数
  timeoutMs: 60_000,
  maxRetries: 1,
} as const;

export const defaultPort = 8787;

export type JudgeMode = "claude" | "deterministic";

// JUDGE_MODE が無ければ、API キーの有無で決める
export function resolveJudgeMode(env: NodeJS.ProcessEnv = process.env): JudgeMode {
  const value = env.JUDGE_MODE?.trim();
  if (value === "claude" || value === "deterministic") return value;
  return env.ANTHROPIC_API_KEY ? "claude" : "deterministic";
}

// 安全のための上限（architecture.md 8 章）
export const safetyLimits = {
  maxRequestBytes: 8 * 1024 * 1024,
  // 画像 1 枚の上限（デコード後のバイト数）
  maxImageBytes: 5 * 1024 * 1024,
  maxObservations: 50,
  rateLimitWindowMs: 60_000,
} as const;

export function resolveRateLimitPerWindow(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(value) && value > 0 ? value : 20;
}

// X-Forwarded-For を信用するか。プロキシの後ろに置くときだけ true にする。既定は接続元アドレス
export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TRUST_PROXY?.trim() === "true";
}

// CORS で許可するオリジン。カンマ区切り
export function resolveCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const value = env.CORS_ORIGINS?.trim();
  if (!value) return ["http://localhost:3000"];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// 決定論モードの判断規則のパラメータ。出典: 開発者の推定（仮）
export const decisionParams = {
  // 乗り換えの手間を考え、待つより この分数以上早く着かなければ切り替えを勧めない
  switchMarginMinutes: 5,
} as const;

// 気象の取得設定
export const weatherParams = {
  defaultWindowMinutes: 60,
  fetchTimeoutMs: 5000,
} as const;

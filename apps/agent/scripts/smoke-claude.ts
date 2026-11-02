import { performance } from "node:perf_hooks";
import {
  type JudgmentEvent,
  JudgmentEventSchema,
  type Lang,
  type Observation,
  type Scenario,
} from "@repo/schema";
import { createGeoProvider } from "../src/alternatives/geo-provider.ts";
import { createApp } from "../src/app.ts";
import { headlineLimits, models, reasonLimits } from "../src/config.ts";
import { loadContentStore } from "../src/content.ts";
import { interpretWithClaude } from "../src/interpret/claude-interpret.ts";
import { checkHeadlineLength, checkReasonLength } from "../src/judge/assemble.ts";
import type { JudgeDeps } from "../src/judge/run-judge.ts";
import { createAnthropicLlmClient, type LlmClient } from "../src/llm-client.ts";
import { loadPrompts } from "../src/prompts/load-prompts.ts";
import { buildScenarioRequest, DEV_CONTENT_DIR } from "../test/helpers.ts";
import { renderNoticePng } from "./notice-png.ts";

// 実 API で claude モードを 1 回動かす確認。pnpm test には含めない
// ダミー内容の主役シナリオの obs_1 と obs_3 を判断し、架空の掲示の画像を Haiku で読む

const SCENARIO_ID = "person_accident_last_train";
const STEP_IDS = ["obs_1", "obs_3"] as const;
const IMAGE_EVENT_TYPE = "person_accident";
const IMAGE_RESUME_CLOCK = "22:50";

type CallRecord = {
  target: string;
  model: string;
  ms: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

type CheckRow = { item: string; target: string; ok: boolean; detail: string };

function printGuide(): void {
  console.log(
    [
      "smoke:claude: ANTHROPIC_API_KEY が無いので、実 API の確認を省略します",
      "",
      "実行するには、キーを環境変数に入れてから呼びます:",
      "  export ANTHROPIC_API_KEY=<あなたのキー>",
      "  pnpm smoke:claude",
      "",
      `呼び出すモデル: 判断 ${models.judgment}、読み取り ${models.interpretation}`,
      "判断 2 回と画像の読み取り 1 回で、Messages API を数回から十数回呼びます",
    ].join("\n"),
  );
}

// 呼び出しごとに所要時間とトークン数を記録する
function createRecordingClient(
  inner: LlmClient,
  records: CallRecord[],
  failures: string[],
  currentTarget: () => string,
): LlmClient {
  return {
    async createMessage(params, options) {
      const started = performance.now();
      // アプリのログはエラー名しか出さないので、原因をここで控える
      const response = await inner.createMessage(params, options).catch((error: unknown) => {
        failures.push(`${currentTarget()} ${params.model}: ${describeError(error)}`);
        throw error;
      });
      records.push({
        target: currentTarget(),
        model: response.model ?? params.model,
        ms: performance.now() - started,
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
        cacheRead: response.usage.cache_read_input_tokens ?? 0,
        cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
      });
      return response;
    },
  };
}

// SSE の本文を読み、各イベントをスキーマで検証する
function parseSse(body: string): { events: JudgmentEvent[]; invalid: string[] } {
  const events: JudgmentEvent[] = [];
  const invalid: string[] = [];
  const blocks = body.split("\n\n").map((block) =>
    block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n"),
  );
  for (const data of blocks.filter((d) => d.length > 0)) {
    const parsed = JudgmentEventSchema.safeParse(JSON.parse(data));
    if (parsed.success) events.push(parsed.data);
    else
      invalid.push(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" / "));
  }
  return { events, invalid };
}

function countLength(text: string | undefined): number {
  return [...(text ?? "")].length;
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function judgeStep(
  app: ReturnType<typeof createApp>,
  scenario: Scenario,
  stepId: string,
  observations: Observation[],
  warnings: string[],
): Promise<{ rows: CheckRow[]; observation: Observation | null; ms: number }> {
  const entry = scenario.timeline.find((t) => t.id === stepId);
  if (!entry) throw new Error(`シナリオに ${stepId} がありません`);
  const language: Lang = scenario.user.language;
  const warningStart = warnings.length;
  const started = performance.now();
  const res = await app.request("/judge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildScenarioRequest(scenario, entry, observations)),
  });
  const { events, invalid } = parseSse(await res.text());
  const ms = performance.now() - started;
  const stepWarnings = warnings.slice(warningStart);

  const judgment = events.find((e) => e.type === "judgment_ready");
  const errorEvent = events.find((e) => e.type === "error");
  const parsed = events.find((e) => e.type === "observation_parsed");
  const fallbacks = stepWarnings.filter((w) => w.includes("決定論モード"));
  const rows: CheckRow[] = [
    {
      item: "イベント列のスキーマ",
      target: stepId,
      ok: invalid.length === 0 && events.length > 0,
      detail:
        invalid.length === 0
          ? `${events.length} 件すべて合格`
          : `不合格 ${invalid.length} 件: ${invalid[0]}`,
    },
    {
      item: "判断まで到達",
      target: stepId,
      ok: judgment !== undefined && errorEvent === undefined,
      detail: errorEvent?.type === "error" ? errorEvent.message : `HTTP ${res.status}`,
    },
    {
      item: "フォールバック無し",
      target: stepId,
      ok: fallbacks.length === 0,
      detail: fallbacks.length === 0 ? "claude モードで完了" : fallbacks.join(" / "),
    },
  ];

  if (judgment?.type === "judgment_ready") {
    const { headline, reason, action } = judgment.judgment;
    const headlineErrors = checkHeadlineLength(headline, language);
    const reasonErrors = checkReasonLength(reason, language);
    rows.push(
      {
        item: "見出しの長さ",
        target: stepId,
        ok: headlineErrors.length === 0,
        detail: `${countLength(headline)}/${headlineLimits[language].max} 字 ${action}「${headline}」`,
      },
      {
        item: "理由の長さ",
        target: stepId,
        ok: reasonErrors.length === 0,
        detail: `${countLength(reason)}/${reasonLimits[language].max} 字「${reason ?? ""}」`,
      },
    );
  }
  return {
    rows,
    observation: parsed?.type === "observation_parsed" ? parsed.observation : null,
    ms,
  };
}

async function interpretNoticeImage(deps: JudgeDeps): Promise<CheckRow[]> {
  const png = renderNoticePng([
    { text: "JR KYOTO LINE", color: [255, 214, 0] },
    { text: "SERVICE SUSPENDED", color: [255, 255, 255] },
    { text: "DUE TO PERSON ACCIDENT", color: [255, 255, 255] },
    { text: `RESUME ABOUT ${IMAGE_RESUME_CLOCK}`, color: [255, 255, 255] },
    { text: "TRANSFER: HANKYU, KEIHAN", color: [120, 220, 255] },
  ]);
  if (!deps.llm) throw new Error("llm がありません");
  const observation = await interpretWithClaude(
    { type: "photo", mediaType: "image/png", imageBase64: png.toString("base64") },
    {
      llm: deps.llm,
      prompts: deps.prompts,
      knowledge: deps.content.knowledge,
      observationId: "obs_photo",
      observedAt: "2026-11-05T22:30:00+09:00",
    },
  );
  const candidates = observation.eventTypeCandidates.map((c) => `${c.eventType}:${c.confidence}`);
  const resume = observation.statedResumeTime;
  const rawText = observation.rawText ?? "";
  return [
    {
      item: "画像の読み取り",
      target: "photo",
      ok: rawText.length > 0,
      detail: `${png.length} バイト。原文「${rawText.replace(/\s+/g, " ").slice(0, 60)}」`,
    },
    {
      item: "画像の事象種別",
      target: "photo",
      ok: observation.eventTypeCandidates.some((c) => c.eventType === IMAGE_EVENT_TYPE),
      detail: candidates.join(", ") || "候補なし",
    },
    {
      item: "画像の再開見込み",
      target: "photo",
      ok: resume?.includes(`T${IMAGE_RESUME_CLOCK}`) ?? false,
      detail: `${resume ?? "null"}。兆候 ${observation.detectedSignals.map((s) => s.signalId).join(", ") || "なし"}`,
    },
  ];
}

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function printTable(headers: readonly string[], rows: readonly (readonly string[])[]): void {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`|${headers.map(() => "---").join("|")}|`);
  for (const row of rows) console.log(`| ${row.map(escapeCell).join(" | ")} |`);
}

function summarizeUsage(records: readonly CallRecord[], stepMs: ReadonlyMap<string, number>) {
  const groups = new Map<string, CallRecord[]>();
  for (const r of records) {
    const key = `${r.target}\u0000${r.model}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const sum = (list: readonly CallRecord[], pick: (r: CallRecord) => number) =>
    list.reduce((acc, r) => acc + pick(r), 0);
  const toRow = (target: string, model: string, list: readonly CallRecord[], ms: number) => [
    target,
    model,
    String(list.length),
    `${(ms / 1000).toFixed(1)} 秒`,
    String(sum(list, (r) => r.input)),
    String(sum(list, (r) => r.output)),
    String(sum(list, (r) => r.cacheRead)),
    String(sum(list, (r) => r.cacheWrite)),
  ];
  const rows = [...groups.entries()].map(([key, list]) => {
    const [target = "", model = ""] = key.split("\u0000");
    return toRow(
      target,
      model,
      list,
      sum(list, (r) => r.ms),
    );
  });
  const totalMs = [...stepMs.values()].reduce((a, b) => a + b, 0);
  rows.push(toRow("合計", "", records, totalMs));
  return rows;
}

async function main(): Promise<number> {
  const content = loadContentStore(DEV_CONTENT_DIR);
  const scenario = content.scenarios.get(SCENARIO_ID);
  if (!scenario) throw new Error(`ダミー内容に ${SCENARIO_ID} がありません`);

  const records: CallRecord[] = [];
  const warnings: string[] = [];
  const failures: string[] = [];
  let target = "";
  const deps: JudgeDeps = {
    mode: "claude",
    content,
    provider: createGeoProvider(),
    fetchRain: async () => null,
    llm: createRecordingClient(createAnthropicLlmClient(), records, failures, () => target),
    prompts: loadPrompts(),
    logWarning: (message) => warnings.push(message),
  };
  const app = createApp({
    judge: deps,
    corsOrigins: ["http://localhost:3000"],
    rateLimitPerWindow: 1000,
  });

  console.log(
    `smoke:claude: ${SCENARIO_ID} の ${STEP_IDS.join(" と ")} を claude モードで判断します`,
  );
  const checks: CheckRow[] = [];
  const stepMs = new Map<string, number>();
  const observations: Observation[] = [];

  for (const stepId of STEP_IDS) {
    target = stepId;
    try {
      const step = await judgeStep(app, scenario, stepId, [...observations], warnings);
      checks.push(...step.rows);
      stepMs.set(stepId, step.ms);
      if (step.observation) observations.push(step.observation);
    } catch (error) {
      checks.push({ item: "判断の実行", target: stepId, ok: false, detail: describeError(error) });
    }
  }

  target = "photo";
  const photoStarted = performance.now();
  try {
    checks.push(...(await interpretNoticeImage(deps)));
  } catch (error) {
    checks.push({
      item: "画像の読み取り",
      target: "photo",
      ok: false,
      detail: describeError(error),
    });
  }
  stepMs.set("photo", performance.now() - photoStarted);

  console.log("\n確認の結果");
  printTable(
    ["確認", "対象", "結果", "詳細"],
    checks.map((c) => [c.item, c.target, c.ok ? "OK" : "NG", c.detail]),
  );
  console.log("\n所要時間とトークン数");
  printTable(
    ["対象", "モデル", "呼び出し", "所要時間", "入力", "出力", "キャッシュ読込", "キャッシュ書込"],
    summarizeUsage(records, stepMs),
  );
  if (failures.length > 0) {
    console.log("\nAPI 呼び出しの失敗");
    for (const f of failures) console.log(`  - ${f}`);
  }
  if (warnings.length > 0) {
    console.log("\n警告");
    for (const w of warnings) console.log(`  - ${w}`);
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed === 0 ? "\nsmoke:claude: 合格" : `\nsmoke:claude: 不合格 ${failed} 件`);
  return failed === 0 ? 0 : 1;
}

if (!process.env.ANTHROPIC_API_KEY) {
  printGuide();
  process.exit(0);
}
process.exit(await main());

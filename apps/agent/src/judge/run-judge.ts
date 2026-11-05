import type { JudgeRequest, Lang, Observation, RawInput, Scenario } from "@repo/schema";
import type { AlternativesProvider } from "../alternatives/provider.ts";
import type { JudgeMode } from "../config.ts";
import type { ContentStore } from "../content.ts";
import { selectEventType } from "../domain/phase.ts";
import { interpretWithClaude } from "../interpret/claude-interpret.ts";
import { interpretRawInputDeterministically } from "../interpret/deterministic-interpret.ts";
import type { LlmClient } from "../llm-client.ts";
import type { Prompts } from "../prompts/load-prompts.ts";
import type { RainFetcher } from "../tools/types.ts";
import { assembleJudgment } from "./assemble.ts";
import { runClaudeJudgment } from "./claude-judge.ts";
import { decideDeterministically } from "./deterministic-decision.ts";
import type { EventSink, JudgmentEventBody } from "./event-sink.ts";
import { createJudgeSession, type JudgeSession } from "./session.ts";
import { buildProgressMessage } from "./templates.ts";

// 1 回の判断の流れ: 解釈 → 兆候 → 段階 → 代替手段 → 分岐点 → 判断
// claude モードが失敗したら、済んだ手順はそのままに決定論モードで仕上げる

export type JudgeDeps = {
  mode: JudgeMode;
  content: ContentStore;
  provider: AlternativesProvider;
  fetchRain: RainFetcher;
  // claude モードで使う。無ければ決定論モードで動く
  llm: LlmClient | null;
  prompts: Prompts;
  // ログ。入力内容と現在地は渡さない
  logWarning: (message: string) => void;
};

export type JudgeOptions = {
  scenarioId: string | null;
  // 利用者が切断したら中断する
  signal?: AbortSignal;
};

function findScenario(
  request: JudgeRequest,
  options: JudgeOptions,
  content: ContentStore,
): Scenario | null {
  const id =
    request.newInput?.type === "scenario" ? request.newInput.scenarioId : options.scenarioId;
  return id ? (content.scenarios.get(id) ?? null) : null;
}

function buildObservationId(input: RawInput, existing: readonly Observation[]): string {
  const taken = new Set(existing.map((o) => o.id));
  const base = input.type === "scenario" ? input.observationId : `obs_${existing.length + 1}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
}

async function interpretNewInput(
  request: JudgeRequest,
  deps: JudgeDeps,
  signal: AbortSignal | undefined,
): Promise<Observation | null> {
  const input = request.newInput;
  if (!input) return null;
  const observationId = buildObservationId(input, request.observations);
  const deterministic = () =>
    interpretRawInputDeterministically(input, {
      knowledge: deps.content.knowledge,
      lines: deps.provider.listLines(),
      contextEventType: selectEventType(request.observations, deps.content.knowledge),
      observationId,
      observedAt: request.now,
    });
  if (deps.mode !== "claude" || !deps.llm || input.type === "selection") return deterministic();
  try {
    return await interpretWithClaude(input, {
      llm: deps.llm,
      prompts: deps.prompts,
      knowledge: deps.content.knowledge,
      observationId,
      observedAt: request.now,
      signal,
    });
  } catch (error) {
    if (signal?.aborted) return null;
    deps.logWarning(
      `解釈を決定論モードに切り替えました: ${error instanceof Error ? error.name : "unknown"}`,
    );
    return deterministic();
  }
}

// 新しい入力を観測にできなかったときの error イベント
// claude モードでは一時的な失敗なので再試行を促す。決定論モードの写真は API キーが無いと読めない
function buildInterpretFailure(language: Lang, claudeAvailable: boolean): JudgmentEventBody {
  if (claudeAvailable) {
    return {
      type: "error",
      message:
        language === "ja"
          ? "読み取りに失敗しました。再試行するか文章で入力してください。"
          : "Could not read the input. Please try again or enter the text instead.",
      retryable: true,
    };
  }
  return {
    type: "error",
    message:
      language === "ja"
        ? "写真の読み取りには Claude の API キーが必要です。発表文の貼り付けか選択式で入力してください。"
        : "Reading photos requires a Claude API key. Please paste the announcement text or use the selection input.",
    retryable: false,
  };
}

// 兆候のイベント。推定した事象種別の兆候を、観測をまたいで重複なく送る
async function emitDetectedSignals(session: JudgeSession, sink: EventSink): Promise<void> {
  const seen = new Set<string>();
  for (const o of session.ctx.observations) {
    for (const signal of o.detectedSignals) {
      const key = `${signal.eventType}/${signal.signalId}`;
      if (seen.has(key)) continue;
      if (session.inferredEventType !== null && signal.eventType !== session.inferredEventType)
        continue;
      seen.add(key);
      await sink.emit({ type: "signal_detected", signal });
    }
  }
}

// 決定論モードの手順。確定済みのツールは呼び直しても結果が変わらず、イベントも重ならない
async function runDeterministicTools(session: JudgeSession): Promise<void> {
  const eventType = session.state.estimate?.estimate.eventType ?? session.inferredEventType;
  const knowledge = eventType ? session.ctx.content.knowledge.get(eventType) : undefined;
  if (knowledge) await session.executeTool("lookup_knowledge", { eventType: knowledge.id });
  if (knowledge?.external_factors.weather) await session.executeTool("get_weather", {});
  await session.executeTool("estimate_phase_and_remaining", { eventType: knowledge?.id ?? null });
  await session.executeTool("find_alternatives", {});
  await session.executeTool("compute_break_even", {});
}

async function finishDeterministically(session: JudgeSession, sink: EventSink): Promise<void> {
  await runDeterministicTools(session);
  const { estimate, alternatives, breakEven } = session.state;
  if (!estimate || !alternatives || !breakEven)
    throw new Error("判断に必要なツールの結果がそろいません");
  const results = { estimate, alternatives, breakEven };
  await session.emitProgress("judgment");
  const decision = decideDeterministically(session, results);
  const checked = session.checkJudgment(
    assembleJudgment(results, decision, session.ctx.request.language),
    results,
  );
  if (!checked.judgment)
    throw new Error(`決定論モードの判断が検証に通りません: ${checked.errors.join(" / ")}`);
  await sink.emit({ type: "judgment_ready", judgment: checked.judgment });
}

export async function runJudge(
  request: JudgeRequest,
  options: JudgeOptions,
  deps: JudgeDeps,
  sink: EventSink,
): Promise<void> {
  if (request.newInput) {
    await sink.emit({
      type: "progress",
      stage: "interpret",
      message: buildProgressMessage("interpret", request.language),
    });
  }
  const signal = options.signal;
  const parsed = await interpretNewInput(request, deps, signal);
  if (signal?.aborted) return;
  if (request.newInput && !parsed) {
    await sink.emit(
      buildInterpretFailure(request.language, deps.mode === "claude" && deps.llm !== null),
    );
    return;
  }
  if (parsed) await sink.emit({ type: "observation_parsed", observation: parsed });

  // 今回読んだ並びだけを反映し、以後の利用者による手直しを古い観測で上書きしない
  if (request.trainPosition?.kind === "between_stations" && parsed?.trainsAhead !== undefined) {
    request = {
      ...request,
      trainPosition: {
        ...request.trainPosition,
        trainsAhead: parsed.trainsAhead,
        trainsAheadCount: null,
        trainsAheadHeadwayMinutes: null,
      },
    };
  }

  const session = createJudgeSession(
    {
      request,
      observations: parsed ? [...request.observations, parsed] : request.observations,
      content: deps.content,
      provider: deps.provider,
      scenario: findScenario(request, options, deps.content),
      fetchRain: deps.fetchRain,
    },
    sink,
  );
  await emitDetectedSignals(session, sink);

  if (deps.mode === "claude" && deps.llm) {
    try {
      const outcome = await runClaudeJudgment(session, {
        llm: deps.llm,
        prompts: deps.prompts,
        signal,
      });
      if (outcome.status === "aborted") return;
      if (outcome.status === "done") {
        await sink.emit({ type: "judgment_ready", judgment: outcome.judgment });
        return;
      }
      deps.logWarning(`判断を決定論モードに切り替えました: ${outcome.reason}`);
    } catch (error) {
      if (signal?.aborted) return;
      deps.logWarning(
        `判断を決定論モードに切り替えました: ${error instanceof Error ? error.name : "unknown"}`,
      );
    }
  }
  await finishDeterministically(session, sink);
}

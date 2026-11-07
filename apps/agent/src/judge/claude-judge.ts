import type {
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Judgment } from "@repo/schema";
import { claudeSettings, models } from "../config.ts";
import type { LlmClient } from "../llm-client.ts";
import type { Prompts } from "../prompts/load-prompts.ts";
import { buildClaudeTools } from "../tools/definitions.ts";
import { DecisionSchema } from "../tools/emit-judgment.ts";
import { assembleJudgment, type JudgmentIssue } from "./assemble.ts";
import { maskSecrets } from "./describe-error.ts";
import type { JudgeSession, ToolOutcome } from "./session.ts";

// Opus による判断ループ。ツールの実行は自前で行い、イベントはセッションが送る
// 失敗（拒否・上限超過・検証の再失敗）は failed を返し、呼び出し側が決定論モードで仕上げる
// 利用者が切断したら aborted を返し、呼び出し側は何も送らずに終える

export type ClaudeJudgeDeps = {
  llm: LlmClient;
  prompts: Prompts;
  signal?: AbortSignal;
};

export type ClaudeJudgeOutcome =
  | { status: "done"; judgment: Judgment }
  // diagnostics は検証に落ちたときの記録。落ちた検査の名前と指摘、判断の文の抜粋を回ごとに 1 行で持つ
  | { status: "failed"; reason: string; diagnostics?: string[] }
  | { status: "aborted" };

// 利用者の入力は観測データとしてシステムプロンプトと分けて渡す
function buildUserMessage(session: JudgeSession): string {
  const { request, observations, scenario } = session.ctx;
  const context = {
    language: request.language,
    now: request.now,
    origin: request.origin,
    destination: request.destination,
    constraints: request.constraints,
    // 車内の位置。駅間なら次の駅・自分の種別・前の列車の並びを持つ。無ければ駅にいる
    trainPosition: request.trainPosition ?? null,
    // 入口で答えた原因の統計値の大分類と種類。分からなければ null。見込みの数値はツールが返す
    cause: request.cause ?? null,
    replay: scenario !== null,
  };
  return [
    `<request>\n${JSON.stringify(context, null, 1)}\n</request>`,
    `<observations>\n${JSON.stringify(observations, null, 1)}\n</observations>`,
    "手順に従ってツールを呼び、最後に emit_judgment で判断を確定してください。",
  ].join("\n");
}

function buildBaseParams(deps: ClaudeJudgeDeps) {
  return {
    model: models.judgment,
    max_tokens: claudeSettings.judgmentMaxTokens,
    fallbacks: "default",
    betas: [claudeSettings.fallbackBeta, claudeSettings.thinkingUpdatesBeta],
    // ツール呼び出しの合間の短い進捗メモを受け取り、progress イベントで流す
    thinking: { type: "adaptive", display: claudeSettings.thinkingDisplay },
    output_config: { effort: claudeSettings.judgmentEffort },
    system: [
      { type: "text", text: deps.prompts.judgmentSystem, cache_control: { type: "ephemeral" } },
    ],
    tools: buildClaudeTools(),
  } satisfies Omit<MessageCreateParamsNonStreaming, "messages">;
}

const MAX_PROGRESS_NOTE_LENGTH = 200;

// Claude の説明文を短文にそろえる。思考のブロックは進捗メモ（display: updates）のときだけ使う
function collectProgressNotes(
  content: BetaMessage["content"],
  includeThinkingUpdates: boolean,
): string[] {
  return content
    .flatMap((b) =>
      b.type === "text"
        ? [b.text]
        : b.type === "thinking" && includeThinkingUpdates
          ? [b.thinking]
          : [],
    )
    .map((t) => t.trim().replace(/\s+/g, " "))
    .filter((t) => t.length > 0);
}

function shortenProgressNote(note: string): string {
  return note.length > MAX_PROGRESS_NOTE_LENGTH
    ? `${note.slice(0, MAX_PROGRESS_NOTE_LENGTH - 1)}…`
    : note;
}

function toToolResult(id: string, outcome: ToolOutcome): BetaToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: id,
    content: JSON.stringify(outcome.content),
    is_error: outcome.isError,
  };
}

const MAX_LOG_EXCERPT_LENGTH = 200;

function shortenForLog(text: string): string {
  const masked = maskSecrets(text.replace(/\s+/g, " ").trim());
  return masked.length > MAX_LOG_EXCERPT_LENGTH
    ? `${masked.slice(0, MAX_LOG_EXCERPT_LENGTH - 1)}…`
    : masked;
}

function readText(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function listEvidenceIds(input: unknown): string {
  const evidence =
    typeof input === "object" && input !== null ? (input as { evidence?: unknown }).evidence : null;
  if (!Array.isArray(evidence)) return "";
  return evidence
    .map((e) => (typeof e === "object" && e !== null ? `${String(e.kind)}/${String(e.id)}` : "?"))
    .join(",");
}

// 検証の失敗を記録の 1 行にする。落ちた検査の名前と指摘、Claude の文の抜粋を 200 字までに切って出す
export function formatValidationFailure(
  attempt: number,
  issues: readonly JudgmentIssue[],
  input: unknown,
): string {
  const found = issues.map((i) => `[${i.check}] ${shortenForLog(i.message)}`).join(" | ");
  const excerpt = [
    `action=${readText(input, "action") ?? "?"}`,
    `headline=「${shortenForLog(readText(input, "headline") ?? "")}」`,
    `reason=「${shortenForLog(readText(input, "reason") ?? "")}」`,
    `evidence=${shortenForLog(listEvidenceIds(input))}`,
  ].join(" ");
  return `判断の検証の失敗 ${attempt} 回目: ${found} :: ${excerpt}`;
}

// emit_judgment を検証し、通れば判断結果を返す
function handleEmitJudgment(
  session: JudgeSession,
  input: unknown,
): { judgment: Judgment | null; outcome: ToolOutcome; issues: JudgmentIssue[] } {
  const { estimate, alternatives, breakEven } = session.state;
  if (!estimate || !alternatives || !breakEven) {
    return {
      judgment: null,
      outcome: {
        isError: true,
        content: {
          error: "先に estimate_remaining・find_alternatives・compute_break_even を呼んでください",
        },
      },
      issues: [{ check: "tool_order", message: "ツールの結果がそろう前に呼ばれました" }],
    };
  }
  const decision = DecisionSchema.safeParse(input);
  if (!decision.success) {
    return {
      judgment: null,
      outcome: {
        isError: true,
        content: { error: "入力がスキーマに合いません", issues: decision.error.issues },
      },
      issues: decision.error.issues.map((i) => ({
        check: "decision_schema",
        message: `${i.path.join(".") || "(ルート)"}: ${i.message}`,
      })),
    };
  }
  const results = { estimate, alternatives, breakEven };
  const checked = session.checkJudgment(
    assembleJudgment(
      results,
      decision.data,
      session.ctx.request.language,
      session.buildInCarGuide(results),
    ),
    results,
  );
  if (checked.judgment)
    return {
      judgment: checked.judgment,
      outcome: { isError: false, content: { ok: true } },
      issues: [],
    };
  return {
    judgment: null,
    issues: checked.issues,
    outcome: {
      isError: true,
      content: {
        error: "判断の検証に失敗しました。指摘を直して emit_judgment を呼び直してください",
        issues: checked.errors,
      },
    },
  };
}

export async function runClaudeJudgment(
  session: JudgeSession,
  deps: ClaudeJudgeDeps,
): Promise<ClaudeJudgeOutcome> {
  const base = buildBaseParams(deps);
  const messages: BetaMessageParam[] = [{ role: "user", content: buildUserMessage(session) }];
  let toolCalls = 0;
  let validationFailures = 0;
  const diagnostics: string[] = [];
  // 失敗の理由に、それまでの検証の失敗の記録を添える
  const fail = (reason: string): ClaudeJudgeOutcome =>
    diagnostics.length > 0
      ? { status: "failed", reason, diagnostics }
      : { status: "failed", reason };
  let nudged = false;
  const includeThinkingUpdates = base.thinking.display === "updates";

  for (let iteration = 0; ; iteration++) {
    if (deps.signal?.aborted) return { status: "aborted" };
    if (iteration >= claudeSettings.maxLoopIterations) {
      return fail("判断ループの反復回数の上限を超えました");
    }
    const response = await deps.llm.createMessage(
      { ...base, messages },
      deps.signal ? { signal: deps.signal } : undefined,
    );
    if (deps.signal?.aborted) return { status: "aborted" };
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      return { status: "failed", reason: `stop_reason: ${response.stop_reason}` };
    }
    // 思考のブロックも含めて、応答をそのまま履歴に戻す
    messages.push({ role: "assistant", content: response.content });
    // 進み具合の文は、送る前に利用者に見せる文と同じ検査を通す。通らない文は流さない
    for (const note of collectProgressNotes(response.content, includeThinkingUpdates)) {
      if (session.checkProgressNote(note)) {
        await session.emitProgress(undefined, shortenProgressNote(note));
      }
    }

    const toolUses = response.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      if (response.stop_reason === "pause_turn") continue;
      if (nudged) return fail("emit_judgment が呼ばれませんでした");
      nudged = true;
      messages.push({ role: "user", content: "emit_judgment を呼んで判断を確定してください。" });
      continue;
    }

    const results: BetaToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      toolCalls += 1;
      if (toolCalls > claudeSettings.maxToolCalls) {
        return fail("ツール呼び出しの上限を超えました");
      }
      if (toolUse.name !== "emit_judgment") {
        results.push(
          toToolResult(toolUse.id, await session.executeTool(toolUse.name, toolUse.input)),
        );
        continue;
      }
      await session.emitProgress("judgment");
      const emitted = handleEmitJudgment(session, toolUse.input);
      if (emitted.judgment) return { status: "done", judgment: emitted.judgment };
      // ツールを呼ぶ前の emit_judgment は再生成の回数に数えない
      diagnostics.push(
        formatValidationFailure(diagnostics.length + 1, emitted.issues, toolUse.input),
      );
      if (session.state.breakEven) validationFailures += 1;
      if (validationFailures > claudeSettings.maxRegenerations) {
        return fail("判断の検証に再び失敗しました");
      }
      results.push(toToolResult(toolUse.id, emitted.outcome));
    }
    messages.push({ role: "user", content: results });
  }
}

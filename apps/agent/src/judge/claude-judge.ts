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
import { buildKnowledgeBlock, type Prompts } from "../prompts/load-prompts.ts";
import { buildClaudeTools } from "../tools/definitions.ts";
import { DecisionSchema } from "../tools/emit-judgment.ts";
import { assembleJudgment, collectAllowedClockMinutes, validateJudgment } from "./assemble.ts";
import type { JudgeSession, ToolOutcome } from "./session.ts";

// Opus による判断ループ。ツールの実行は自前で行い、イベントはセッションが送る
// 失敗（拒否・上限超過・検証の再失敗）は null を返し、呼び出し側が決定論モードで仕上げる

export type ClaudeJudgeDeps = {
  llm: LlmClient;
  prompts: Prompts;
};

export type ClaudeJudgeOutcome =
  | { status: "done"; judgment: Judgment }
  | { status: "failed"; reason: string };

// 利用者の入力は観測データとしてシステムプロンプトと分けて渡す
function buildUserMessage(session: JudgeSession): string {
  const { request, observations, scenario } = session.ctx;
  const context = {
    language: request.language,
    now: request.now,
    origin: request.origin,
    destination: request.destination,
    constraints: request.constraints,
    replay: scenario !== null,
  };
  return [
    `<request>\n${JSON.stringify(context, null, 1)}\n</request>`,
    `<observations>\n${JSON.stringify(observations, null, 1)}\n</observations>`,
    "手順に従ってツールを呼び、最後に emit_judgment で判断を確定してください。",
  ].join("\n");
}

function buildBaseParams(session: JudgeSession, deps: ClaudeJudgeDeps) {
  return {
    model: models.judgment,
    max_tokens: claudeSettings.judgmentMaxTokens,
    fallbacks: "default",
    betas: [claudeSettings.fallbackBeta, claudeSettings.thinkingUpdatesBeta],
    // ツール呼び出しの合間の短い進捗メモを受け取り、progress イベントで流す
    thinking: { type: "adaptive", display: "updates" },
    output_config: { effort: claudeSettings.judgmentEffort },
    system: [
      { type: "text", text: deps.prompts.judgmentSystem },
      {
        type: "text",
        text: buildKnowledgeBlock(session.ctx.content.knowledge),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: buildClaudeTools(),
  } satisfies Omit<MessageCreateParamsNonStreaming, "messages">;
}

const MAX_PROGRESS_NOTE_LENGTH = 200;

// Claude の説明文と進捗メモを短文にそろえる
function collectProgressNotes(content: BetaMessage["content"]): string[] {
  return content
    .flatMap((b) => (b.type === "text" ? [b.text] : b.type === "thinking" ? [b.thinking] : []))
    .map((t) => t.trim().replace(/\s+/g, " "))
    .filter((t) => t.length > 0)
    .map((t) =>
      t.length > MAX_PROGRESS_NOTE_LENGTH ? `${t.slice(0, MAX_PROGRESS_NOTE_LENGTH - 1)}…` : t,
    );
}

function toToolResult(id: string, outcome: ToolOutcome): BetaToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: id,
    content: JSON.stringify(outcome.content),
    is_error: outcome.isError,
  };
}

// emit_judgment を検証し、通れば判断結果を返す
function handleEmitJudgment(
  session: JudgeSession,
  input: unknown,
): { judgment: Judgment | null; outcome: ToolOutcome } {
  const { estimate, alternatives, breakEven } = session.state;
  if (!estimate || !alternatives || !breakEven) {
    return {
      judgment: null,
      outcome: {
        isError: true,
        content: {
          error:
            "先に estimate_phase_and_remaining・find_alternatives・compute_break_even を呼んでください",
        },
      },
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
    };
  }
  const results = { estimate, alternatives, breakEven };
  const checked = validateJudgment({
    judgment: assembleJudgment(results, decision.data, session.ctx.request.language),
    evidenceRefs: session.collectEvidenceRefs(),
    allowedClockMinutes: collectAllowedClockMinutes(
      results,
      session.ctx.observations,
      session.ctx.request.now,
    ),
  });
  if (checked.judgment)
    return { judgment: checked.judgment, outcome: { isError: false, content: { ok: true } } };
  return {
    judgment: null,
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
  const base = buildBaseParams(session, deps);
  const messages: BetaMessageParam[] = [{ role: "user", content: buildUserMessage(session) }];
  let toolCalls = 0;
  let validationFailures = 0;
  let nudged = false;

  for (;;) {
    const response = await deps.llm.createMessage({ ...base, messages });
    if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
      return { status: "failed", reason: `stop_reason: ${response.stop_reason}` };
    }
    // 思考のブロックも含めて、応答をそのまま履歴に戻す
    messages.push({ role: "assistant", content: response.content });
    for (const note of collectProgressNotes(response.content)) {
      await session.emitProgress(undefined, note);
    }

    const toolUses = response.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) {
      if (response.stop_reason === "pause_turn") continue;
      if (nudged) return { status: "failed", reason: "emit_judgment が呼ばれませんでした" };
      nudged = true;
      messages.push({ role: "user", content: "emit_judgment を呼んで判断を確定してください。" });
      continue;
    }

    const results: BetaToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      toolCalls += 1;
      if (toolCalls > claudeSettings.maxToolCalls) {
        return { status: "failed", reason: "ツール呼び出しの上限を超えました" };
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
      if (session.state.breakEven) validationFailures += 1;
      if (validationFailures > claudeSettings.maxRegenerations) {
        return { status: "failed", reason: "判断の検証に再び失敗しました" };
      }
      results.push(toToolResult(toolUse.id, emitted.outcome));
    }
    messages.push({ role: "user", content: results });
  }
}

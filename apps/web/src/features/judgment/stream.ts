import {
  type JudgeRequest,
  type JudgmentEvent,
  type JudgmentEventOf,
  JudgmentEventSchema,
} from "@repo/schema";
import { createSseParser, type SseMessage } from "./sse";

// エージェントの POST /judge を呼び、SSE の判断イベントを検証して順に返す

export const defaultAgentUrl = "http://localhost:8787";

export type StreamOptions = {
  signal?: AbortSignal;
  agentUrl?: string;
  fetchImpl?: typeof fetch;
};

export type JudgmentStream = (
  request: JudgeRequest,
  options: StreamOptions,
) => AsyncGenerator<JudgmentEvent>;

export function resolveAgentUrl(): string {
  return process.env.NEXT_PUBLIC_AGENT_URL || defaultAgentUrl;
}

// 画面側で起きた失敗も error イベントとして同じ経路で扱う
export function buildClientError(
  message: string,
  retryable: boolean,
  lastSeq: number,
): JudgmentEventOf<"error"> {
  return {
    type: "error",
    seq: lastSeq + 1,
    at: new Date().toISOString(),
    message,
    retryable,
  };
}

type ParseResult =
  | { ok: true; event: JudgmentEvent }
  | { ok: false; reason: string }
  | { ok: "skip"; type: string };

const knownEventTypes: ReadonlySet<string> = new Set(
  JudgmentEventSchema.options.map((option) => option.shape.type.value),
);

// 画面が知らない種類のイベント。エージェント側で種類が増えても読み飛ばして続ける
function findUnknownEventType(json: unknown): string | null {
  if (typeof json !== "object" || json === null || !("type" in json)) return null;
  const type = json.type;
  return typeof type === "string" && !knownEventTypes.has(type) ? type : null;
}

// 1 メッセージを JudgmentEventSchema で検証する。event 名と type の食い違いも不正とする
export function parseJudgmentEvent(message: SseMessage): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(message.data);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  const unknownType = findUnknownEventType(json);
  if (unknownType !== null) return { ok: "skip", type: unknownType };
  const parsed = JudgmentEventSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: "invalid_event" };
  if (message.event !== null && message.event !== "message" && message.event !== parsed.data.type) {
    return { ok: false, reason: "event_type_mismatch" };
  }
  return { ok: true, event: parsed.data };
}

function isTerminal(event: JudgmentEvent): boolean {
  return event.type === "judgment_ready" || event.type === "error";
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function* streamJudgment(
  request: JudgeRequest,
  { signal, agentUrl = resolveAgentUrl(), fetchImpl = fetch }: StreamOptions = {},
): AsyncGenerator<JudgmentEvent> {
  let lastSeq = -1;
  let response: Response;
  try {
    response = await fetchImpl(`${agentUrl.replace(/\/$/, "")}/judge`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    if (signal?.aborted) return;
    yield buildClientError("network_error", true, lastSeq);
    return;
  }

  if (!response.ok || response.body === null) {
    yield buildClientError(`http_${response.status}`, isRetryableStatus(response.status), lastSeq);
    return;
  }

  const parser = createSseParser();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      const messages = done ? parser.flush() : parser.push(value);
      for (const message of messages) {
        const result = parseJudgmentEvent(message);
        if (result.ok === "skip") continue;
        if (!result.ok) {
          yield buildClientError(result.reason, true, lastSeq);
          return;
        }
        lastSeq = result.event.seq;
        yield result.event;
        if (isTerminal(result.event)) return;
      }
      if (done) break;
    }
  } catch {
    if (signal?.aborted) return;
    yield buildClientError("network_error", true, lastSeq);
    return;
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  // judgment_ready も error も来ないまま閉じた
  yield buildClientError("stream_incomplete", true, lastSeq);
}

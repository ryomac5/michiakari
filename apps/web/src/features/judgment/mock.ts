import type { JudgeRequest, JudgmentEvent } from "@repo/schema";
import { buildPersonAccidentEvents } from "./fixtures/person-accident";
import type { StreamOptions } from "./stream";

// ネットワークを使わず、架空のイベント列を一定間隔で流す

export const defaultMockIntervalMs = 700;

// NEXT_PUBLIC_JUDGE_MOCK=1 か、開発サーバーで ?mock=1 を付けたときにモックを使う
export function isMockRequested(search: string): boolean {
  if (process.env.NEXT_PUBLIC_JUDGE_MOCK === "1") return true;
  if (process.env.NODE_ENV === "production") return false;
  return new URLSearchParams(search).get("mock") === "1";
}

function waitFor(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function* streamMockJudgment(
  request: JudgeRequest,
  { signal, intervalMs = defaultMockIntervalMs }: StreamOptions & { intervalMs?: number } = {},
): AsyncGenerator<JudgmentEvent> {
  for (const event of buildPersonAccidentEvents(request)) {
    await waitFor(intervalMs, signal);
    if (signal?.aborted) return;
    yield event;
  }
}

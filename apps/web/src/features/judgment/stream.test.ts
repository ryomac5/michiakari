import type { JudgmentEvent } from "@repo/schema";
import { describe, expect, it, vi } from "vitest";
import { buildPersonAccidentEvents } from "./fixtures/person-accident";
import { parseJudgmentEvent, streamJudgment } from "./stream";
import { buildTestRequest } from "./test-helpers";

function encodeSse(events: unknown[]): string {
  return events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
}

// 文字列を指定の大きさに切って流す Response を作る
function buildSseResponse(body: string, chunkSize = 17, status = 200): Response {
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { "content-type": "text/event-stream" } });
}

async function collect(iterable: AsyncIterable<JudgmentEvent>): Promise<JudgmentEvent[]> {
  const out: JudgmentEvent[] = [];
  for await (const e of iterable) out.push(e);
  return out;
}

describe("streamJudgment", () => {
  const request = buildTestRequest();
  const events = buildPersonAccidentEvents(request);

  it("POST {agentUrl}/judge に要求を送り、検証したイベントを順に返す", async () => {
    const fetchImpl = vi.fn(async () => buildSseResponse(encodeSse(events)));
    const out = await collect(
      streamJudgment(request, { agentUrl: "http://agent.test/", fetchImpl }),
    );

    expect(out).toEqual(events);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://agent.test/judge",
      expect.objectContaining({ method: "POST", body: JSON.stringify(request) }),
    );
  });

  it("スキーマに合わないイベントは error に変えて打ち切る", async () => {
    const first = events[0];
    const body = `${encodeSse([first])}event: phase_estimated\ndata: {"type":"phase_estimated","seq":1}\n\n${encodeSse(events.slice(1))}`;
    const out = await collect(
      streamJudgment(request, { fetchImpl: async () => buildSseResponse(body) }),
    );

    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({
      type: "error",
      message: "invalid_event",
      retryable: true,
      seq: 1,
    });
  });

  it("JSON として読めない data は error にする", async () => {
    const out = await collect(
      streamJudgment(request, { fetchImpl: async () => buildSseResponse("data: {oops\n\n") }),
    );
    expect(out).toEqual([expect.objectContaining({ type: "error", message: "invalid_json" })]);
  });

  it("HTTP エラーは状態コード付きの error にする。5xx は再試行できる", async () => {
    const out = await collect(
      streamJudgment(request, { fetchImpl: async () => new Response("down", { status: 503 }) }),
    );
    expect(out).toEqual([
      expect.objectContaining({ type: "error", message: "http_503", retryable: true }),
    ]);

    const bad = await collect(
      streamJudgment(request, { fetchImpl: async () => new Response("bad", { status: 400 }) }),
    );
    expect(bad[0]).toMatchObject({ message: "http_400", retryable: false });
  });

  it("通信に失敗したら再試行できる error にする", async () => {
    const out = await collect(
      streamJudgment(request, {
        fetchImpl: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    );
    expect(out).toEqual([
      expect.objectContaining({ type: "error", message: "network_error", retryable: true }),
    ]);
  });

  it("judgment_ready も error も無いまま閉じたら stream_incomplete にする", async () => {
    const partial = events.slice(0, 2);
    const out = await collect(
      streamJudgment(request, { fetchImpl: async () => buildSseResponse(encodeSse(partial)) }),
    );
    expect(out.slice(0, 2)).toEqual(partial);
    expect(out[2]).toMatchObject({ type: "error", message: "stream_incomplete", seq: 2 });
  });

  it("中断したときは何も返さずに終わる", async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await collect(
      streamJudgment(request, {
        signal: controller.signal,
        fetchImpl: async () => {
          throw new DOMException("aborted", "AbortError");
        },
      }),
    );
    expect(out).toEqual([]);
  });
});

describe("parseJudgmentEvent", () => {
  it("event 名と data の type が食い違えば不正とする", () => {
    const [first] = buildPersonAccidentEvents(buildTestRequest());
    expect(parseJudgmentEvent({ event: "judgment_ready", data: JSON.stringify(first) })).toEqual({
      ok: false,
      reason: "event_type_mismatch",
    });
    expect(parseJudgmentEvent({ event: null, data: JSON.stringify(first) })).toEqual({
      ok: true,
      event: first,
    });
  });
});

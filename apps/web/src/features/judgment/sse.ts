// SSE（text/event-stream）の行を読み、メッセージ単位に組み立てる

export type SseMessage = {
  event: string | null;
  data: string;
};

export type SseParser = {
  push: (chunk: string) => SseMessage[];
  flush: () => SseMessage[];
};

export function createSseParser(): SseParser {
  let buffer = "";
  let eventName: string | null = null;
  let dataLines: string[] = [];

  function dispatch(out: SseMessage[]): void {
    if (dataLines.length > 0) out.push({ event: eventName, data: dataLines.join("\n") });
    eventName = null;
    dataLines = [];
  }

  function processLine(line: string, out: SseMessage[]): void {
    if (line === "") {
      dispatch(out);
      return;
    }
    if (line.startsWith(":")) return;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const rawValue = colon === -1 ? "" : line.slice(colon + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") eventName = value;
    if (field === "data") dataLines.push(value);
  }

  function push(chunk: string): SseMessage[] {
    const out: SseMessage[] = [];
    buffer += chunk;
    // 末尾の \r は次の塊の \n と組になる可能性があるので持ち越す
    const holdsCr = buffer.endsWith("\r");
    const text = holdsCr ? buffer.slice(0, -1) : buffer;
    const lines = text.split(/\r\n|\r|\n/);
    const rest = lines.pop() ?? "";
    buffer = holdsCr ? `${rest}\r` : rest;
    for (const line of lines) processLine(line, out);
    return out;
  }

  // ストリームの終端。空行で閉じられていない最後のメッセージも返す
  function flush(): SseMessage[] {
    const out: SseMessage[] = [];
    const rest = buffer.replace(/\r$/, "");
    buffer = "";
    if (rest !== "") processLine(rest, out);
    dispatch(out);
    return out;
  }

  return { push, flush };
}

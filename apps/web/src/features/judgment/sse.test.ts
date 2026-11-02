import { describe, expect, it } from "vitest";
import { createSseParser } from "./sse";

describe("createSseParser", () => {
  it("空行でメッセージを区切り、event と data を返す", () => {
    const parser = createSseParser();
    const out = parser.push('event: a\ndata: {"x":1}\n\nevent: b\ndata: 2\n\n');
    expect(out).toEqual([
      { event: "a", data: '{"x":1}' },
      { event: "b", data: "2" },
    ]);
  });

  it("塊の途中で切れた行を次の塊とつなぐ", () => {
    const parser = createSseParser();
    expect(parser.push("event: a\nda")).toEqual([]);
    expect(parser.push("ta: hel")).toEqual([]);
    expect(parser.push("lo\n\n")).toEqual([{ event: "a", data: "hello" }]);
  });

  it("CRLF と、塊の境目で分かれた CR LF を一つの改行として扱う", () => {
    const parser = createSseParser();
    expect(parser.push("data: a\r")).toEqual([]);
    expect(parser.push("\n\r\n")).toEqual([{ event: null, data: "a" }]);
  });

  it("複数の data 行は改行でつなぎ、コメント行は無視する", () => {
    const parser = createSseParser();
    expect(parser.push(": ping\ndata: 1\ndata: 2\n\n")).toEqual([{ event: null, data: "1\n2" }]);
  });

  it("data の無いメッセージは返さない", () => {
    const parser = createSseParser();
    expect(parser.push("event: a\n\n")).toEqual([]);
  });

  it("flush で空行の無い最後のメッセージも返す", () => {
    const parser = createSseParser();
    expect(parser.push("event: a\ndata: 1")).toEqual([]);
    expect(parser.flush()).toEqual([{ event: "a", data: "1" }]);
  });
});

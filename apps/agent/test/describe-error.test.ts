import { AuthenticationError, NotFoundError } from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { describeError, maskSecrets } from "../src/judge/describe-error.ts";

describe("describeError", () => {
  it("AuthenticationError からクラス名、状態コード、error.type を取り出す", () => {
    const error = new AuthenticationError(
      401,
      { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
      "401 invalid x-api-key",
      new Headers(),
    );
    const text = describeError(error);
    expect(text).toContain("AuthenticationError");
    expect(text).toContain("status=401");
    expect(text).toContain("type=authentication_error");
  });

  it("NotFoundError からクラス名、状態コード、error.type を取り出す", () => {
    const error = new NotFoundError(
      404,
      { type: "error", error: { type: "not_found_error", message: "model: x" } },
      "404 model: x",
      new Headers(),
    );
    const text = describeError(error);
    expect(text).toContain("NotFoundError");
    expect(text).toContain("status=404");
    expect(text).toContain("type=not_found_error");
  });

  it("キーらしい文字列を伏せ、メッセージを 200 字に切る", () => {
    const text = describeError(new Error(`bad key sk-ant-api03-abcDEF_123 ${"あ".repeat(500)}`));
    expect(text).not.toContain("sk-ant-api03");
    expect(text).toContain("sk-ant-***");
    expect((text.split("message=")[1] ?? "").length).toBeLessThanOrEqual(200);
  });

  it("例外でない値は unknown にする", () => {
    expect(describeError("x")).toBe("unknown");
    expect(maskSecrets("sk-ant-abc")).toBe("sk-ant-***");
  });
});

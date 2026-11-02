import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { claudeSettings } from "./config.ts";

// Messages API への入口。テストではこの型の偽物を渡す

export type LlmClient = {
  createMessage(
    params: MessageCreateParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): Promise<BetaMessage>;
};

// API キーは環境変数 ANTHROPIC_API_KEY から SDK が読む
export function createAnthropicLlmClient(): LlmClient {
  const client = new Anthropic({
    timeout: claudeSettings.timeoutMs,
    maxRetries: claudeSettings.maxRetries,
  });
  return {
    createMessage: (params, options) =>
      client.beta.messages.create(params, options?.signal ? { signal: options.signal } : undefined),
  };
}

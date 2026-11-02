import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

// Messages API への入口。テストではこの型の偽物を渡す

export type LlmClient = {
  createMessage(params: MessageCreateParamsNonStreaming): Promise<BetaMessage>;
};

// API キーは環境変数 ANTHROPIC_API_KEY から SDK が読む
export function createAnthropicLlmClient(): LlmClient {
  const client = new Anthropic();
  return { createMessage: (params) => client.beta.messages.create(params) };
}

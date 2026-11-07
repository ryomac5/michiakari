// 例外から、記録に出してよい失敗の理由だけを取り出す

const MAX_MESSAGE_LENGTH = 200;
const KEY_PATTERN = /sk-ant-[A-Za-z0-9_-]+/g;

export function maskSecrets(text: string): string {
  return text.replace(KEY_PATTERN, "sk-ant-***");
}

function readApiErrorType(error: object): string | undefined {
  const body = (error as { error?: unknown }).error;
  if (typeof body !== "object" || body === null) return undefined;
  const inner = (body as { error?: unknown }).error;
  const candidate = typeof inner === "object" && inner !== null ? inner : body;
  const type = (candidate as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

// 例: "AuthenticationError status=401 type=authentication_error message=invalid x-api-key"
export function describeError(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown";
  const parts = [error.constructor?.name || "Error"];
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") parts.push(`status=${status}`);
  const type = readApiErrorType(error);
  if (type) parts.push(`type=${type}`);
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && message) {
    parts.push(`message=${maskSecrets(message).slice(0, MAX_MESSAGE_LENGTH)}`);
  }
  return parts.join(" ");
}

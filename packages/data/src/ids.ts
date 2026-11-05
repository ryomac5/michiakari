// 安定した ID の生成。日本語は残し、URL で意味を持つ記号と空白は "_" にする

export function sanitizeIdPart(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}ー_-]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildLineId(operatorKey: string, lineName: string): string {
  return `${sanitizeIdPart(operatorKey)}.${sanitizeIdPart(lineName)}`;
}

export function buildStationId(lineId: string, stationName: string): string {
  return `${lineId}.${sanitizeIdPart(stationName)}`;
}

import type { RawInput } from "@repo/schema";

// 撮影した画像を長辺を抑えた JPEG に変換し、送信できる形にする

const maxEdge = 1600;
const jpegQuality = 0.85;

export type PhotoInput = Extract<RawInput, { type: "photo" }>;

export function computeScaledSize(
  width: number,
  height: number,
  limit = maxEdge,
): { width: number; height: number } {
  const scale = Math.min(1, limit / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function stripDataUrlPrefix(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

// ブラウザが読めない形式なら例外になる。呼び出し側で表示に変える
export async function preparePhoto(file: File): Promise<{ input: PhotoInput; previewUrl: string }> {
  const bitmap = await createImageBitmap(file);
  const size = computeScaledSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
  return {
    input: { type: "photo", imageBase64: stripDataUrlPrefix(dataUrl), mediaType: "image/jpeg" },
    previewUrl: dataUrl,
  };
}

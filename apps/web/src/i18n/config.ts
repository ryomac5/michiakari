import { type Lang, LangSchema } from "@repo/schema";

// 言語は URL に含めず cookie で持つ。既定は日本語
export const locales = LangSchema.options;
export const defaultLocale: Lang = "ja";
export const localeCookieName = "NEXT_LOCALE";
export const themeCookieName = "theme";
export const timeZone = "Asia/Tokyo";

export type Theme = "dark" | "light";

// cookie の値を対応する言語に解決する。未知の値は既定に倒す
export function resolveLocale(value: string | undefined): Lang {
  const parsed = LangSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultLocale;
}

// cookie の値をテーマに解決する。既定はライト
export function resolveTheme(value: string | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

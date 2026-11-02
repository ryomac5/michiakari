"use client";

import { Moon } from "lucide-react";
import { useTranslations } from "next-intl";
import { testIds } from "@/features/judgment/testids";
import { type Theme, themeCookieName } from "@/i18n/config";
import { useDocumentTheme } from "@/lib/use-document-theme";
import { cn } from "@/lib/utils";

// html のクラスを即座に切り替え、cookie に保存して次回のサーバー描画に反映する
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(theme);
  // biome-ignore lint/suspicious/noDocumentCookie: テーマの保存先はサーバー描画でも読める cookie にする
  document.cookie = `${themeCookieName}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

// メニューの 1 行。ダーク表示の入り切りをスイッチで示す
export function ThemeToggle() {
  const t = useTranslations("app");
  const theme = useDocumentTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      data-testid={testIds.app.themeToggle}
      data-theme={theme}
      onClick={() => applyTheme(dark ? "light" : "dark")}
      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 text-left text-[15px] font-medium transition-colors hover:bg-foreground/5"
    >
      <Moon className="size-5 text-muted" strokeWidth={1.75} aria-hidden />
      <span className="flex-1">{t("menu.darkMode")}</span>
      <span
        aria-hidden
        className={cn(
          "relative h-6 w-10 rounded-full transition-colors duration-200",
          dark ? "bg-foreground" : "bg-foreground/15",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow-sm transition-transform duration-200",
            dark && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

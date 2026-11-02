"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { testIds } from "@/features/judgment/testids";
import { type Theme, themeCookieName } from "@/i18n/config";

// html のクラスを即座に切り替え、cookie に保存して次回のサーバー描画に反映する
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  root.classList.add(theme);
  // biome-ignore lint/suspicious/noDocumentCookie: テーマの保存先はサーバー描画でも読める cookie にする
  document.cookie = `${themeCookieName}=${theme}; path=/; max-age=31536000; samesite=lax`;
}

export function ThemeToggle({ initialTheme }: { initialTheme: Theme }) {
  const t = useTranslations("app.theme");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? t("toLight") : t("toDark");

  return (
    <button
      type="button"
      data-testid={testIds.app.themeToggle}
      data-theme={theme}
      aria-label={label}
      title={label}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-surface-raised"
    >
      {theme === "dark" ? (
        <Sun className="size-5" aria-hidden />
      ) : (
        <Moon className="size-5" aria-hidden />
      )}
    </button>
  );
}

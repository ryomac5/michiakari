"use client";

import { FlaskConical, Info } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useJudgmentSession } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import type { Theme } from "@/i18n/config";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ThemeToggle } from "./ThemeToggle";

export function AppHeader({ initialTheme }: { initialTheme: Theme }) {
  const t = useTranslations("app");
  const { mockEnabled } = useJudgmentSession();

  return (
    <header data-testid={testIds.app.header} className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2">
        <Link
          href="/"
          data-testid={testIds.app.homeLink}
          className="mr-auto truncate text-base font-extrabold tracking-tight"
        >
          {t("title")}
        </Link>
        <LanguageSwitcher />
        <ThemeToggle initialTheme={initialTheme} />
        <Link
          href="/about"
          data-testid={testIds.app.aboutLink}
          aria-label={t("about")}
          title={t("about")}
          className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-surface-raised"
        >
          <Info className="size-5" aria-hidden />
        </Link>
      </div>
      {mockEnabled && (
        <p
          data-testid={testIds.app.mockBadge}
          className="flex items-center justify-center gap-2 bg-hold-surface px-4 py-1 text-sm font-bold text-hold"
        >
          <FlaskConical className="size-4" aria-hidden />
          {t("mockBadge")}
        </p>
      )}
    </header>
  );
}

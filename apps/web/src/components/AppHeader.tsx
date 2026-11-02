"use client";

import { BookOpen, FlaskConical, Info } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useJudgmentSession } from "@/features/judgment/session";
import { testIds } from "@/features/judgment/testids";
import type { Theme } from "@/i18n/config";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { LogoMark } from "./LogoMark";
import { ThemeToggle } from "./ThemeToggle";

export function AppHeader({ initialTheme }: { initialTheme: Theme }) {
  const t = useTranslations("app");
  const { mockEnabled } = useJudgmentSession();

  return (
    <header data-testid={testIds.app.header} className="border-b border-border bg-surface">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-xl focus:bg-primary focus:px-4 focus:py-3 focus:font-bold focus:text-primary-foreground"
      >
        {t("skipToContent")}
      </a>
      <div className="mx-auto flex max-w-2xl items-center gap-1 px-2 py-1.5 sm:gap-2 sm:px-4">
        <Link
          href="/"
          data-testid={testIds.app.homeLink}
          aria-label={`${t("name")} — ${t("home")}`}
          className="mr-auto flex min-h-11 min-w-0 items-center gap-1.5 rounded-xl pr-1"
        >
          <LogoMark className="size-7 sm:size-8" />
          <span className="flex flex-col leading-none">
            <span className="text-lg font-extrabold tracking-tight whitespace-nowrap">
              {t("name")}
            </span>
            <span className="mt-1 hidden text-xs font-bold text-muted sm:block">
              {t("tagline")}
            </span>
          </span>
        </Link>
        <LanguageSwitcher />
        <ThemeToggle initialTheme={initialTheme} />
        <Link
          href="/knowledge"
          data-testid={testIds.app.knowledgeLink}
          aria-label={t("knowledge")}
          title={t("knowledge")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-surface-raised"
        >
          <BookOpen className="size-5" aria-hidden />
        </Link>
        <Link
          href="/about"
          data-testid={testIds.app.aboutLink}
          aria-label={t("about")}
          title={t("about")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-surface-raised"
        >
          <Info className="size-5" aria-hidden />
        </Link>
      </div>
      {mockEnabled && (
        <p
          data-testid={testIds.app.mockBadge}
          className="flex items-center justify-center gap-1.5 bg-hold-surface px-4 py-0.5 text-xs font-bold text-hold"
        >
          <FlaskConical className="size-3.5" aria-hidden />
          {t("mockBadge")}
        </p>
      )}
    </header>
  );
}

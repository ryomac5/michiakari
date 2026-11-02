"use client";

import type { Lang } from "@repo/schema";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { testIds } from "@/features/judgment/testids";
import { saveLocale } from "@/i18n/actions";
import { locales } from "@/i18n/config";
import { cn } from "@/lib/utils";

const labels: Record<Lang, string> = { ja: "日本語", en: "English" };

export function LanguageSwitcher() {
  const t = useTranslations("app");
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function changeLocale(next: Lang) {
    if (next === locale) return;
    startTransition(async () => {
      await saveLocale(next);
      router.refresh();
    });
  }

  return (
    <fieldset
      data-testid={testIds.app.languageSwitch}
      aria-label={t("language")}
      disabled={isPending}
      className="flex shrink-0 rounded-xl bg-foreground/[0.06] p-0.5"
    >
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          data-testid={testIds.app.language(l)}
          aria-pressed={l === locale}
          onClick={() => changeLocale(l)}
          className={cn(
            "h-11 rounded-[10px] px-3 text-[13px] font-medium whitespace-nowrap text-muted transition-colors",
            l === locale && "bg-surface text-foreground shadow-sm",
          )}
        >
          {labels[l]}
        </button>
      ))}
    </fieldset>
  );
}

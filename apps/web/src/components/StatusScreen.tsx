"use client";

import { Map as MapIcon, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { testIds } from "@/features/judgment/testids";
import { BackdropMap } from "@/features/map/BackdropMap";
import { AppHeader } from "./AppHeader";
import { LogoMark } from "./LogoMark";

// 見つからない頁と、思わぬエラーの画面。地図を背景に、次の一手を 2 つだけ示す
export function StatusScreen({
  kind,
  onRetry,
}: {
  kind: "notFound" | "error";
  onRetry?: () => void;
}) {
  const t = useTranslations("status");
  return (
    <>
      <BackdropMap />
      <AppHeader />
      <main
        id="main"
        data-testid={testIds.status.screen}
        data-kind={kind}
        className="relative z-10 flex min-h-dvh items-center justify-center px-4 pt-[88px] pb-16"
      >
        <section className="glass-strong flex w-full max-w-md animate-rise-in flex-col items-center gap-5 rounded-[28px] px-6 py-8 text-center">
          <LogoMark className="size-16" />
          <div className="flex flex-col gap-2">
            <h1 className="text-[24px] leading-tight font-bold tracking-tight text-balance">
              {t(`${kind}.title`)}
            </h1>
            <p className="text-[15px] leading-relaxed text-muted">{t(`${kind}.lead`)}</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            {onRetry ? (
              <button
                type="button"
                data-testid={testIds.status.retry}
                onClick={onRetry}
                className={buttonVariants({ className: "rounded-full" })}
              >
                <RotateCcw aria-hidden />
                {t("retry")}
              </button>
            ) : (
              <Link
                href="/"
                data-testid={testIds.status.home}
                className={buttonVariants({ className: "rounded-full" })}
              >
                <MapIcon aria-hidden />
                {t("home")}
              </Link>
            )}
            <Link
              href={onRetry ? "/" : "/replay"}
              className={buttonVariants({ variant: "secondary", className: "rounded-full" })}
            >
              {onRetry ? <MapIcon aria-hidden /> : <Play aria-hidden />}
              {onRetry ? t("home") : t("demo")}
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}

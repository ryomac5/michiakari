"use client";

import { ChevronLeft, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { testIds } from "@/features/judgment/testids";
import { cn } from "@/lib/utils";

// 入口のシート。判断の画面のシートと同じ面で、スマートフォンでは下から、PC 幅では右に浮かせる
// 高さは中身に合わせ、地図に重なる高さを知らせる
export function EntrySheet({
  stageKey,
  onBack,
  onHeightChange,
  progress,
  compact = false,
  children,
}: {
  // 段が変わるたびに中身を短い動きで差し替える
  stageKey: string;
  onBack: () => void;
  onHeightChange: (height: number) => void;
  // 戻るの右に置く進み具合の印
  progress?: ReactNode;
  // 地図を押して選ぶ段。地図の見える範囲を残すため、シートを低く抑えて中身を送る
  compact?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations();
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => onHeightChange(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeightChange]);

  return (
    <section
      ref={ref}
      data-testid={testIds.start.sheet}
      aria-labelledby="entry-sheet-title"
      className={cn(
        "fixed inset-x-0 bottom-0 z-20 flex animate-rise-in flex-col rounded-t-[28px] border border-b-0 border-[var(--glass-border)] bg-surface shadow-[0_-4px_24px_rgb(0_0_0/0.10)] lg:top-4 lg:right-4 lg:bottom-auto lg:left-auto lg:max-h-[calc(100dvh-32px)] lg:w-[400px] lg:rounded-[24px] lg:border-b lg:shadow-[var(--shadow-float)]",
        compact ? "max-h-[min(56dvh,640px)]" : "max-h-[min(78dvh,640px)]",
      )}
    >
      <div aria-hidden className="flex h-4 shrink-0 justify-center pt-2 lg:hidden">
        <span className="h-[5px] w-9 rounded-full bg-foreground/15" />
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pt-2 pb-[max(16px,env(safe-area-inset-bottom))] lg:px-6 lg:pt-5">
        <div key={stageKey} className="flex animate-step-in flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              data-testid={testIds.start.back}
              onClick={onBack}
              className="-ml-2 inline-flex min-h-11 w-fit items-center gap-0.5 rounded-full pr-3 pl-1 text-[14px] font-medium text-muted transition-colors hover:bg-foreground/5 hover:text-foreground active:scale-[0.97]"
            >
              <ChevronLeft className="size-5" strokeWidth={2} aria-hidden />
              {t("entry.back")}
            </button>
            {progress}
          </div>
          {children}
        </div>
        <p className="mt-5 flex items-center gap-1.5 text-[12px] text-muted">
          <Info className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          {t("disclaimer.short")}
        </p>
      </div>
    </section>
  );
}

export function SheetTitle({
  eyebrow,
  title,
  hint,
}: {
  eyebrow?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {eyebrow}
      <h1
        id="entry-sheet-title"
        className="text-[24px] leading-tight font-bold tracking-tight text-balance"
      >
        {title}
      </h1>
      {hint && <p className="text-[14px] leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

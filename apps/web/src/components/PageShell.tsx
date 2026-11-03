import type { ReactNode } from "react";
import { BackdropMap } from "@/features/map/BackdropMap";
import { cn } from "@/lib/utils";
import { AppHeader } from "./AppHeader";

// 地図以外の画面の土台。入口と同じ淡い地図を背景に敷き、その上に角の丸い面を並べる
export function PageShell({
  testId,
  state,
  wide = false,
  children,
}: {
  testId: string;
  // 画面の状態。e2e が data-state で読む
  state?: string;
  // 格子を広く使う画面（リプレイの一覧、知見）
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <BackdropMap />
      <AppHeader />
      <main
        id="main"
        data-testid={testId}
        data-state={state}
        className={cn(
          "relative z-10 mx-auto flex min-h-dvh flex-col gap-4 px-3 pt-[88px] pb-16 sm:px-4 lg:pt-[96px]",
          wide ? "max-w-6xl" : "max-w-4xl",
        )}
      >
        {children}
      </main>
    </>
  );
}

// 画面の最初の面。左に丸い印、右に見出しと話しかける一文
export function PageHero({
  icon,
  title,
  lead,
  children,
}: {
  icon: ReactNode;
  title: string;
  lead: string;
  children?: ReactNode;
}) {
  return (
    <section className="glass-strong flex animate-rise-in flex-col gap-4 rounded-[28px] p-5 sm:p-7">
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 sm:items-start">
        <span
          aria-hidden
          className="row-span-1 flex size-12 shrink-0 items-center justify-center rounded-[18px] bg-brand/12 text-brand sm:row-span-2 sm:size-14 sm:rounded-[20px] [&>svg]:size-6 [&>svg]:stroke-[1.75] sm:[&>svg]:size-7"
        >
          {icon}
        </span>
        <h1 className="text-[26px] leading-tight font-bold tracking-tight text-balance sm:text-[30px]">
          {title}
        </h1>
        {/* 狭い画面では印の下から全幅で読ませる */}
        <p className="col-span-2 text-[15px] leading-relaxed text-muted sm:col-span-1 sm:col-start-2">
          {lead}
        </p>
      </div>
      {children}
    </section>
  );
}

// 中身の面。判断のシートと同じ白い面に、柔らかい影を付ける
export function PageCard({
  className,
  children,
  testId,
  id,
}: {
  className?: string;
  children: ReactNode;
  testId?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      data-testid={testId}
      className={cn("glass-strong flex flex-col gap-3 rounded-[24px] p-5 sm:p-6", className)}
    >
      {children}
    </section>
  );
}

// 空の状態。丸い印と短い一文で、次にできることを示す
export function EmptyState({
  icon,
  title,
  children,
  testId,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center gap-3 rounded-[24px] bg-foreground/[0.04] px-6 py-8 text-center"
    >
      <span
        aria-hidden
        className="flex size-12 items-center justify-center rounded-full bg-surface text-muted shadow-[0_1px_6px_rgb(0_0_0/0.1)] [&>svg]:size-6 [&>svg]:stroke-[1.75]"
      >
        {icon}
      </span>
      <p className="text-[15px] font-semibold text-balance">{title}</p>
      {children}
    </div>
  );
}

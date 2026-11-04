"use client";

import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { testIds } from "@/features/judgment/testids";
import { cn } from "@/lib/utils";

// 地図の上に重ねるシート。スマートフォンでは下から 3 段階で開き、PC 幅では右に浮かせたパネルになる
// summary は閉じた状態でも見える要点、children は開くと見える詳細

export type SheetSnap = "collapsed" | "half" | "full";
const snaps: SheetSnap[] = ["collapsed", "half", "full"];

// 上部の帯（56px）と余白のぶん。全部開いてもこの高さだけ地図を残す
export const sheetTopInset = 76;
// 閉じた状態の高さの範囲。上限は画面の高さに応じて広げ、結論・再開の見込み・分岐点・注意書きが切れないようにする
const collapsedRange = { min: 180, max: 300, maxShare: 0.46, maxPx: 400 } as const;

function computeCollapsedMax(viewport: number): number {
  return clamp(
    Math.round(viewport * collapsedRange.maxShare),
    collapsedRange.max,
    collapsedRange.maxPx,
  );
}
// 指を離した位置からどれだけ先まで勢いで進めるか（ms）
const flingMs = 160;
const dragThresholdPx = 6;
const desktopQuery = "(min-width: 1024px)";

type Layout = { viewport: number; collapsed: number; top: number };

function computeSnapHeight(snap: SheetSnap, layout: Layout): number {
  const full = layout.viewport - layout.top;
  if (snap === "full") return full;
  if (snap === "half") {
    return Math.min(full, Math.max(layout.collapsed + 200, layout.viewport * 0.56));
  }
  return layout.collapsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isDesktop(): boolean {
  return window.matchMedia(desktopQuery).matches;
}

type DragState = {
  pointerId: number;
  startY: number;
  startOffset: number;
  lastY: number;
  lastT: number;
  velocity: number;
  active: boolean;
};

export function MapSheet({
  label,
  snap,
  onSnapChange,
  onCollapsedHeightChange,
  topInset = sheetTopInset,
  summary,
  children,
}: {
  label: string;
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  // 閉じた状態の高さ。地図の余白に使う
  onCollapsedHeightChange?: (height: number) => void;
  // 全部開いたときに上に残す高さ。リプレイは再生バーのぶん広げる
  topInset?: number;
  summary: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("sheet");
  const hintId = useId();
  const bodyId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [dragOffset, setDragOffset] = useState<number | null>(null);

  // 画面の高さと、要点の高さから閉じた状態の高さを測る
  useLayoutEffect(() => {
    const summaryEl = summaryRef.current;
    if (!summaryEl) return;
    function measure() {
      if (!summaryEl) return;
      // 取っ手の 20px と下端の余白を足す
      const collapsed = clamp(
        Math.ceil(summaryEl.offsetHeight + 20 + 12),
        collapsedRange.min,
        computeCollapsedMax(window.innerHeight),
      );
      setLayout((prev) =>
        prev?.viewport === window.innerHeight &&
        prev.collapsed === collapsed &&
        prev.top === topInset
          ? prev
          : { viewport: window.innerHeight, collapsed, top: topInset },
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(summaryEl);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [topInset]);

  useEffect(() => {
    if (layout) onCollapsedHeightChange?.(layout.collapsed);
  }, [layout, onCollapsedHeightChange]);

  // 全部開いた状態から戻したら、詳細を先頭まで戻す
  useEffect(() => {
    if (snap !== "full" && bodyRef.current && !isDesktop()) bodyRef.current.scrollTop = 0;
  }, [snap]);

  const full = layout ? layout.viewport - layout.top : null;
  const restingOffset = layout && full !== null ? full - computeSnapHeight(snap, layout) : null;
  const offset = dragOffset ?? restingOffset;

  const step = useCallback(
    (delta: number) => {
      const index = clamp(snaps.indexOf(snap) + delta, 0, snaps.length - 1);
      onSnapChange(snaps[index] as SheetSnap);
    },
    [snap, onSnapChange],
  );

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const next =
      e.key === "ArrowUp"
        ? 1
        : e.key === "ArrowDown"
          ? -1
          : e.key === "End"
            ? 2
            : e.key === "Home"
              ? -2
              : 0;
    if (next === 0) return;
    e.preventDefault();
    step(next);
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || isDesktop() || restingOffset === null) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startOffset: restingOffset,
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocity: 0,
      active: false,
    };
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !layout || full === null) return;
    const dy = e.clientY - drag.startY;
    if (!drag.active) {
      if (Math.abs(dy) < dragThresholdPx) return;
      drag.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dt = Math.max(1, e.timeStamp - drag.lastT);
    drag.velocity = (e.clientY - drag.lastY) / dt;
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    setDragOffset(clamp(drag.startOffset + dy, 0, full - layout.collapsed + 40));
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.active || !layout || full === null || dragOffset === null) return;
    suppressClickRef.current = true;
    // 勢いを足した位置に最も近い段へ止める
    const projected = full - (dragOffset + drag.velocity * flingMs);
    const nearest = snaps.reduce((best, s) =>
      Math.abs(computeSnapHeight(s, layout) - projected) <
      Math.abs(computeSnapHeight(best, layout) - projected)
        ? s
        : best,
    );
    setDragOffset(null);
    onSnapChange(nearest);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  // 要点の何もないところを触ったら半分まで開く
  function handleSummaryClick(e: MouseEvent<HTMLDivElement>) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if ((e.target as HTMLElement).closest("button, a, input, textarea, label")) return;
    if (snap === "collapsed" && !isDesktop()) onSnapChange("half");
  }

  // 隠れている部品にキーボードで移ったら、全部開いて見えるようにする
  function handleFocus(e: FocusEvent<HTMLElement>) {
    if (isDesktop() || snap === "full") return;
    const rect = e.target.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 4) onSnapChange("full");
  }

  const style = {
    "--sheet-h": full !== null ? `${full}px` : `calc(100dvh - ${topInset}px)`,
    "--sheet-offset":
      offset !== null
        ? `${offset}px`
        : `calc(100dvh - ${topInset}px - ${collapsedRange.min + 20}px)`,
  } as CSSProperties;

  return (
    <section
      ref={sectionRef}
      data-testid={testIds.judgment.sheet}
      data-snap={snap}
      aria-label={label}
      onFocusCapture={handleFocus}
      style={style}
      className={cn(
        "fixed inset-x-0 bottom-0 z-20 border border-[var(--glass-border)] bg-surface shadow-[0_-4px_24px_rgb(0_0_0/0.10)] flex h-[var(--sheet-h)] translate-y-[var(--sheet-offset)] flex-col rounded-t-[24px] border-b-0",
        dragOffset === null &&
          "transition-[translate] duration-[280ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]",
        "lg:top-4 lg:right-4 lg:bottom-4 lg:left-auto lg:h-auto lg:w-[400px] lg:translate-y-0 lg:rounded-[24px] lg:border-b lg:shadow-[var(--shadow-float)]",
      )}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: キーボードでは取っ手のボタンで開閉する */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 指で引く領域。操作の本体は取っ手のボタン */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleSummaryClick}
        className="shrink-0 touch-none select-none lg:touch-auto lg:select-auto"
      >
        <div className="relative flex h-5 justify-center lg:hidden">
          {/* 見た目は細い棒、押せる範囲は 44px */}
          <button
            type="button"
            data-testid={testIds.judgment.sheetHandle}
            aria-label={t("handle")}
            aria-expanded={snap !== "collapsed"}
            aria-controls={bodyId}
            aria-describedby={hintId}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              onSnapChange(snap === "full" ? "collapsed" : snap === "half" ? "full" : "half");
            }}
            onKeyDown={handleKeyDown}
            className="absolute top-0 z-10 flex h-11 w-24 items-start justify-center rounded-full pt-2"
          >
            <span className="h-[5px] w-9 rounded-full bg-foreground/20" />
          </button>
          <span id={hintId} className="sr-only">
            {t(`state.${snap}`)} {t("hint")}
          </span>
        </div>
        <div ref={summaryRef} className="px-4 pb-3 lg:px-5 lg:pt-5">
          {summary}
        </div>
      </div>
      <div
        ref={bodyRef}
        id={bodyId}
        className={cn(
          "min-h-0 flex-1 overscroll-contain px-4 pb-[max(24px,env(safe-area-inset-bottom))] lg:overflow-y-auto lg:px-5",
          snap === "full" ? "overflow-y-auto" : "overflow-hidden",
        )}
      >
        {children}
      </div>
    </section>
  );
}

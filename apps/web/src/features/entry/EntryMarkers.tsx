"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { testIds } from "@/features/judgment/testids";
import { cn } from "@/lib/utils";
import type { LabelSide } from "./areas";

// 入口の地図の印。押せる範囲は丸を中心にした 48px の四角で、名前の札はその外側に出す

const labelSideClass: Record<LabelSide, string> = {
  right: "left-[calc(50%+14px)] top-1/2 -translate-y-1/2",
  left: "right-[calc(50%+14px)] top-1/2 -translate-y-1/2",
  top: "bottom-[calc(50%+14px)] left-1/2 -translate-x-1/2",
  bottom: "top-[calc(50%+14px)] left-1/2 -translate-x-1/2",
};

function stop(handler: () => void) {
  return (e: MouseEvent) => {
    e.stopPropagation();
    handler();
  };
}

// 札を辺の方向へずらす量（px）。上下に置くなら横へ、左右に置くなら縦へずらす
function buildSlideStyle(side: LabelSide, slide: number): CSSProperties | undefined {
  if (slide === 0) return undefined;
  return side === "top" || side === "bottom" ? { marginLeft: slide } : { marginTop: slide };
}

function MarkerButton({
  label,
  side,
  slide = 0,
  onClick,
  testId,
  dim = false,
  pressed,
  hitRadius,
  dot,
  labelHidden = false,
  children,
}: {
  label: string;
  side: LabelSide;
  slide?: number;
  onClick: () => void;
  testId: string;
  dim?: boolean;
  pressed?: boolean;
  // 押せる丸の半径（px）。指定すると四角い入れ物は押せず、この丸と札だけが押せる
  hitRadius?: number;
  dot: ReactNode;
  // 名前の札を出さず、印だけを残す
  labelHidden?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      aria-pressed={pressed}
      onClick={stop(onClick)}
      className={cn(
        "group relative flex size-12 animate-fade-in items-center justify-center rounded-full transition-opacity duration-200",
        hitRadius === undefined ? "pointer-events-auto" : "pointer-events-none",
        dim && "opacity-45 hover:opacity-100",
      )}
    >
      {hitRadius !== undefined && (
        // 札の面と見分けるため aria-hidden を付けない。中身の無い押せる範囲
        <span
          data-hit-area
          className="pointer-events-auto absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ width: hitRadius * 2, height: hitRadius * 2 }}
        />
      )}
      {dot}
      <span
        aria-hidden
        data-label-hidden={labelHidden || undefined}
        className={cn(
          "pointer-events-auto absolute flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface text-foreground shadow-[0_2px_10px_rgb(0_0_0/0.16)] ring-1 ring-[var(--glass-border)] transition-transform duration-150 group-hover:scale-[1.04] group-active:scale-95",
          labelSideClass[side],
          labelHidden && "hidden",
        )}
        style={buildSlideStyle(side, slide)}
      >
        {children}
      </span>
    </button>
  );
}

// 関西の段の大きな丸
export function HubMarker({
  areaId,
  label,
  side,
  slide,
  onSelect,
}: {
  areaId: string;
  label: string;
  side: LabelSide;
  slide: number;
  onSelect: () => void;
}) {
  return (
    <MarkerButton
      label={label}
      side={side}
      slide={slide}
      onClick={onSelect}
      testId={testIds.start.hub(areaId)}
      dot={
        <span className="flex size-[26px] items-center justify-center rounded-full bg-surface shadow-[0_2px_10px_rgb(0_0_0/0.22)] transition-transform duration-150 group-hover:scale-110 group-active:scale-90">
          <span className="size-3 rounded-full bg-brand" />
        </span>
      }
    >
      <span className="px-3.5 py-1.5 text-[15px] leading-none font-bold">{label}</span>
    </MarkerButton>
  );
}

function LineSwatches({ colors }: { colors: string[] }) {
  return (
    <span className="flex gap-0.5">
      {colors.slice(0, 4).map((color, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 同じ色の路線が並ぶことがあり、位置で見分ける
          key={i}
          className="h-3 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

// 小さな文字の札に添える路線色の点。近くの似た名前の駅を色で見分ける
function LineDots({ colors }: { colors: string[] }) {
  return (
    <span className="flex gap-0.5">
      {colors.slice(0, 4).map((color, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 同じ色の路線が並ぶことがあり、位置で見分ける
          key={i}
          className="size-[5px] rounded-full"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

const smallSideClass: Record<LabelSide, string> = {
  right: "left-[calc(50%+9px)] top-1/2 -translate-y-1/2",
  left: "right-[calc(50%+9px)] top-1/2 -translate-y-1/2",
  top: "bottom-[calc(50%+9px)] left-1/2 -translate-x-1/2",
  bottom: "top-[calc(50%+9px)] left-1/2 -translate-x-1/2",
};

// 駅の印を押した点。札を押したかも添える。キーで押したときは null
export type PlaceTap = { clientX: number; clientY: number; label: boolean } | null;

function readPlaceTap(e: MouseEvent): PlaceTap {
  if (e.detail === 0) return null;
  const target = e.target as HTMLElement | null;
  return {
    clientX: e.clientX,
    clientY: e.clientY,
    label: Boolean(target?.closest("[data-station-label]")),
  };
}

// 地図の駅。乗降客数の多い駅は大きめの丸と札、少ない駅は小さな丸と小さな文字にする
// 名前が重なる駅は印だけを出し、押せば選べる。選んだ駅は判断の画面の現在地と同じ青い丸にする
export function PlaceMarker({
  placeKey,
  label,
  layout,
  major,
  hitRadius,
  colors,
  selected,
  dim,
  hereLabel,
  onSelect,
}: {
  placeKey: string;
  label: string;
  layout: { side: LabelSide; size: "large" | "small"; slide: number; tappable: boolean } | null;
  major: boolean;
  // 印として押せる丸の半径（px）。隣の駅の印に届かない大きさ
  hitRadius: number;
  colors: string[];
  selected: boolean;
  dim: boolean;
  hereLabel: string;
  onSelect: (tap: PlaceTap) => void;
}) {
  const dot = selected ? (
    <span className="relative size-5">
      <span aria-hidden className="absolute -inset-3 animate-here-pulse rounded-full bg-focus/30" />
      <span className="absolute inset-0 rounded-full border-[3px] border-white bg-focus shadow-[0_1px_6px_rgb(0_0_0/0.35)]" />
    </span>
  ) : (
    <span
      className={cn(
        "rounded-full bg-surface shadow-[0_1px_4px_rgb(0_0_0/0.25)] transition-transform duration-150 group-hover:scale-110 group-active:scale-90",
        major ? "size-[15px] border-[3.5px]" : "size-[11px] border-[2.5px]",
      )}
      style={{ borderColor: colors[0] ?? "currentColor" }}
    />
  );
  return (
    <button
      type="button"
      data-testid={testIds.start.place(placeKey)}
      data-label={layout?.size ?? "none"}
      aria-label={label}
      aria-pressed={selected}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(readPlaceTap(e));
      }}
      className={cn(
        "group pointer-events-none relative flex animate-fade-in items-center justify-center rounded-full transition-opacity duration-200",
        major || selected ? "size-12" : "size-11",
        dim && "opacity-45 hover:opacity-100",
      )}
    >
      {/* 押せるのはこの丸と、押せる札だけ。ボタンの四角は隣の駅の印に掛かるので押せなくする */}
      <span
        aria-hidden
        data-hit-area
        className="pointer-events-auto absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ width: hitRadius * 2, height: hitRadius * 2 }}
      />
      {dot}
      {layout?.size === "large" && (
        <span
          aria-hidden
          data-station-label
          className={cn(
            layout.tappable ? "pointer-events-auto" : "pointer-events-none",
            "absolute flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface px-2.5 py-1.5 text-[13px] leading-none font-semibold text-foreground shadow-[0_2px_10px_rgb(0_0_0/0.16)] ring-1 ring-[var(--glass-border)] transition-transform duration-150 group-hover:scale-[1.04] group-active:scale-95",
            labelSideClass[layout.side],
          )}
          style={buildSlideStyle(layout.side, layout.slide)}
        >
          {selected && <span className="text-focus">{hereLabel}</span>}
          {label}
          <LineSwatches colors={colors} />
        </span>
      )}
      {layout?.size === "small" && (
        <span
          aria-hidden
          data-station-label
          className={cn(
            layout.tappable ? "pointer-events-auto" : "pointer-events-none",
            "absolute flex h-[18px] items-center gap-1 whitespace-nowrap rounded-[5px] bg-surface/90 px-1 text-[11px] leading-none font-semibold text-foreground shadow-[0_1px_3px_rgb(0_0_0/0.12)]",
            smallSideClass[layout.side],
          )}
          style={buildSlideStyle(layout.side, layout.slide)}
        >
          {selected && <span className="text-focus">{hereLabel}</span>}
          {label}
          <LineDots colors={colors} />
        </span>
      )}
    </button>
  );
}

// 行き先のピン。判断の画面の行き先と同じ形にする
export function DestinationMarker({ label }: { label: string }) {
  return (
    <div
      data-testid={testIds.start.destinationPin}
      className="relative flex animate-drop-in flex-col items-center"
    >
      <span className="mb-1 rounded-full bg-surface ring-1 ring-[var(--glass-border)] px-2.5 py-1.5 text-[13px] leading-none font-semibold whitespace-nowrap text-foreground shadow-[0_2px_10px_rgb(0_0_0/0.16)]">
        {label}
      </span>
      <svg
        width="28"
        height="36"
        viewBox="0 0 28 36"
        aria-hidden
        className="text-foreground drop-shadow-[0_2px_4px_rgb(0_0_0/0.3)]"
      >
        <path
          d="M14 35c-6-8-12-13-12-20a12 12 0 0 1 24 0c0 7-6 12-12 20Z"
          fill="currentColor"
          stroke="white"
          strokeWidth="2"
        />
        <circle cx="14" cy="14" r="4.5" fill="white" />
      </svg>
    </div>
  );
}

// 方面・行き先・近い駅の札。地図からも答えを選べるようにする
// 方面の札は路線色の丸に矢印を添え、駅の札は路線色の縁の小さな丸にする
export function StopMarker({
  stopKey,
  label,
  side,
  color,
  angle,
  line = false,
  hitRadius,
  labelHidden = false,
  onSelect,
}: {
  stopKey: string;
  label: string;
  side: LabelSide;
  color: string;
  // 方面の札だけが持つ矢印の向き（度）
  angle: number | null;
  // 路線の札。丸を路線色で塗り、札に路線色の印を添える
  line?: boolean;
  hitRadius?: number;
  labelHidden?: boolean;
  onSelect: () => void;
}) {
  return (
    <MarkerButton
      label={label}
      side={side}
      hitRadius={hitRadius}
      labelHidden={labelHidden}
      onClick={onSelect}
      testId={testIds.start.mapStop(stopKey)}
      dot={
        line ? (
          <span
            className="size-[15px] rounded-full border-[3px] border-white shadow-[0_1px_4px_rgb(0_0_0/0.3)] transition-transform duration-150 group-hover:scale-110 group-active:scale-90"
            style={{ backgroundColor: color }}
          />
        ) : angle === null ? (
          <span
            className="size-[13px] rounded-full border-[3px] bg-surface shadow-[0_1px_4px_rgb(0_0_0/0.25)] transition-transform duration-150 group-hover:scale-110 group-active:scale-90"
            style={{ borderColor: color }}
          />
        ) : (
          <span
            className="flex size-7 items-center justify-center rounded-full text-white shadow-[0_2px_8px_rgb(0_0_0/0.3)] transition-transform duration-150 group-hover:scale-110 group-active:scale-90"
            style={{ backgroundColor: color }}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              aria-hidden
              style={{ transform: `rotate(${angle}deg)` }}
            >
              <path
                d="M12 19V5M5 12l7-7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )
      }
    >
      <span
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 leading-none",
          angle === null && !line ? "text-[13px] font-semibold" : "text-[14px] font-bold",
        )}
      >
        {line && (
          <span aria-hidden className="h-3 w-1.5 rounded-full" style={{ backgroundColor: color }} />
        )}
        {label}
      </span>
    </MarkerButton>
  );
}

// 車内の駅の間の丸。線の中ほどに置き、押すとその駅の間を選ぶ
// 押せる丸は、駅の印と札の丸に届かない大きさにする。取れなければ印だけを出し、線を押して選ぶ
export function SegmentMarker({
  segmentKey,
  label,
  color,
  selected,
  hitRadius,
  approachRadius = 0,
  onSelect,
}: {
  segmentKey: string;
  label: string;
  color: string;
  selected: boolean;
  hitRadius: number;
  // 押せる丸が取れないとき、押して寄せる範囲の半径（px）
  approachRadius?: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testIds.start.mapSegment(segmentKey)}
      data-selected={selected}
      data-mode={hitRadius > 0 ? "pick" : approachRadius > 0 ? "approach" : "none"}
      aria-label={label}
      aria-pressed={selected}
      onClick={stop(onSelect)}
      className="group pointer-events-none relative flex size-11 animate-fade-in items-center justify-center rounded-full"
    >
      {hitRadius > 0 && (
        <span
          aria-hidden
          data-hit-area
          className="pointer-events-auto absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ width: hitRadius * 2, height: hitRadius * 2 }}
        />
      )}
      {hitRadius <= 0 && approachRadius > 0 && (
        <span
          aria-hidden
          data-approach-area
          className="pointer-events-auto absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ width: approachRadius * 2, height: approachRadius * 2 }}
        />
      )}
      <span
        aria-hidden
        data-segment-dot
        className={cn(
          "rounded-full border-2 border-white shadow-[0_1px_4px_rgb(0_0_0/0.3)] transition-transform duration-150 group-hover:scale-125 group-active:scale-90",
          selected ? "size-4 bg-focus" : "size-[11px]",
        )}
        style={selected ? undefined : { backgroundColor: color }}
      />
    </button>
  );
}

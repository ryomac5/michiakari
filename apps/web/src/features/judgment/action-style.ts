import type { Action, RouteOption } from "@repo/schema";
import {
  Car,
  Footprints,
  Hourglass,
  type LucideIcon,
  PauseCircle,
  Repeat2,
  TrainFront,
} from "lucide-react";

// 行動の種類ごとの色とアイコン。色だけに頼らず、必ずアイコンとラベルを併用する

export type ActionStyle = {
  icon: LucideIcon;
  text: string;
  surface: string;
  border: string;
};

export const actionStyles: Record<Action, ActionStyle> = {
  wait: {
    icon: Hourglass,
    text: "text-wait",
    surface: "bg-wait-surface",
    border: "border-wait-border",
  },
  switch: {
    icon: Repeat2,
    text: "text-switch",
    surface: "bg-switch-surface",
    border: "border-switch-border",
  },
  hold: {
    icon: PauseCircle,
    text: "text-hold",
    surface: "bg-hold-surface",
    border: "border-hold-border",
  },
};

export const optionIcons: Record<RouteOption["kind"], LucideIcon> = {
  wait: Hourglass,
  transfer: TrainFront,
  taxi: Car,
  walk: Footprints,
};

// 選択肢の種類を行動の色に対応させる。待つは wait、それ以外は switch
export function selectOptionTone(kind: RouteOption["kind"]): Action {
  return kind === "wait" ? "wait" : "switch";
}

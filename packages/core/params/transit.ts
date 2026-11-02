// 路線種別ごとの表定速度と運転間隔。関西にオープンな時刻表がないための概算値
// 出典: 開発者の推定（仮）。各社の時刻表から転記した値ではない

export const LINE_TYPES = [
  "jr_rapid",
  "jr_local",
  "private_express",
  "private_local",
  "subway",
  "monorail",
] as const;
export type LineType = (typeof LINE_TYPES)[number];

export const TIMES_OF_DAY = ["daytime", "rush", "night", "late_night"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const TRANSIT_PARAMS_SOURCE = "開発者の推定（仮）";

// 表定速度（km/h）。出典: 開発者の推定（仮）
export const SCHEDULED_SPEED_KMH: Readonly<Record<LineType, number>> = {
  jr_rapid: 60,
  jr_local: 35,
  private_express: 50,
  private_local: 30,
  subway: 32,
  monorail: 33,
};

// 運転間隔（分）。出典: 開発者の推定（仮）
export const HEADWAY_MINUTES: Readonly<Record<LineType, Readonly<Record<TimeOfDay, number>>>> = {
  jr_rapid: { daytime: 15, rush: 10, night: 15, late_night: 20 },
  jr_local: { daytime: 10, rush: 6, night: 12, late_night: 15 },
  private_express: { daytime: 10, rush: 8, night: 12, late_night: 20 },
  private_local: { daytime: 10, rush: 6, night: 12, late_night: 15 },
  subway: { daytime: 7, rush: 4, night: 8, late_night: 10 },
  monorail: { daytime: 10, rush: 6, night: 10, late_night: 15 },
};

// 時間帯の区切り（日本時間、0 時からの分。start 以上 end 未満）。平日・休日は区別しない
// 出典: 開発者の推定（仮）
export const TIME_OF_DAY_RANGES: readonly {
  startMinute: number;
  endMinute: number;
  timeOfDay: TimeOfDay;
}[] = [
  { startMinute: 0, endMinute: 5 * 60, timeOfDay: "late_night" },
  { startMinute: 5 * 60, endMinute: 7 * 60, timeOfDay: "night" },
  { startMinute: 7 * 60, endMinute: 9 * 60 + 30, timeOfDay: "rush" },
  { startMinute: 9 * 60 + 30, endMinute: 17 * 60, timeOfDay: "daytime" },
  { startMinute: 17 * 60, endMinute: 19 * 60 + 30, timeOfDay: "rush" },
  { startMinute: 19 * 60 + 30, endMinute: 23 * 60, timeOfDay: "night" },
  { startMinute: 23 * 60, endMinute: 24 * 60, timeOfDay: "late_night" },
];

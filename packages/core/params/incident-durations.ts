// 運転見合わせから再開までの所要時間の統計値。このファイルは生成物で、手で書き換えない
// 生成元: docs/research/rail-suspensions/build_incident_durations.py（作成日 2026-11-06）
// 元の事例: 公開の報道と鉄道会社の発表から集めた関西の事例 141 件（重複 0 件を除外）
// 報道に残る事例は長引いたものに偏るため、実際の所要時間より長めに出る
// 分位は線形補間で求め、p50 と p80 は分に丸めた。時間の記録が無い事例は含まない

// 件数が足りない種類は use_group とし、統計値を使わず大分類の値に頼る
// 件数が足りない大分類は insufficient とする。事例が 1 件も無い種類は件数 0 で、統計値は null
export const MIN_TYPE_COUNT = 5;
export const MIN_GROUP_COUNT = 3;

export const INCIDENT_GROUP_IDS = [
  "passenger",
  "vehicle",
  "signaling",
  "power",
  "obstruction",
  "infrastructure",
  "weather",
  "major_accident",
] as const;
export type IncidentGroupId = (typeof INCIDENT_GROUP_IDS)[number];

export const INCIDENT_TYPE_IDS = [
  "person_collision",
  "medical_response",
  "passenger_conflict",
  "track_intrusion",
  "suspicious_object",
  "vehicle_failure",
  "vehicle_smoke",
  "signal_failure",
  "point_failure",
  "power_outage",
  "vegetation_obstruction",
  "foreign_object",
  "animal_collision",
  "crossing_obstruction",
  "track_structure_damage",
  "building_falling_object",
  "bridge_impact",
  "track_smoke_check",
  "heat_rail_deformation",
  "heavy_rain",
  "strong_wind",
  "earthquake",
  "lightning",
  "snow_ice",
  "crossing_collision",
  "derailment",
  "onboard_fire",
] as const;
export type IncidentTypeId = (typeof INCIDENT_TYPE_IDS)[number];

export type DurationReliability = "sufficient" | "use_group" | "insufficient";

// 所要時間（分）。stopScopeCounts は見合わせの範囲ごとの件数。範囲の記録が無い事例は unknown
export type IncidentDurationStats = {
  count: number;
  min: number | null;
  p50: number | null;
  p80: number | null;
  max: number | null;
  stopScopeCounts: Readonly<Record<string, number>>;
  reliability: DurationReliability;
};

export type IncidentTypeDurationStats = IncidentDurationStats & {
  groupId: IncidentGroupId;
};

export type IncidentGroupDurations = Readonly<Record<IncidentGroupId, IncidentDurationStats>>;
export type IncidentTypeDurations = Readonly<Record<IncidentTypeId, IncidentTypeDurationStats>>;

export const INCIDENT_GROUP_DURATIONS: IncidentGroupDurations = {
  passenger: {
    count: 53,
    min: 23,
    p50: 84,
    p80: 112,
    max: 255,
    stopScopeCounts: {
      section: 36,
      unknown: 17,
    },
    reliability: "sufficient",
  },
  vehicle: {
    count: 7,
    min: 52,
    p50: 85,
    p80: 95,
    max: 140,
    stopScopeCounts: {
      section: 2,
      unknown: 5,
    },
    reliability: "sufficient",
  },
  signaling: {
    count: 9,
    min: 70,
    p50: 190,
    p80: 278,
    max: 531,
    stopScopeCounts: {
      section: 4,
      unknown: 5,
    },
    reliability: "sufficient",
  },
  power: {
    count: 4,
    min: 15,
    p50: 268,
    p80: 489,
    max: 510,
    stopScopeCounts: {
      section: 2,
      unknown: 2,
    },
    reliability: "sufficient",
  },
  obstruction: {
    count: 24,
    min: 10,
    p50: 75,
    p80: 144,
    max: 325,
    stopScopeCounts: {
      section: 18,
      unknown: 6,
    },
    reliability: "sufficient",
  },
  infrastructure: {
    count: 15,
    min: 27,
    p50: 86,
    p80: 197,
    max: 375,
    stopScopeCounts: {
      section: 9,
      unknown: 6,
    },
    reliability: "sufficient",
  },
  weather: {
    count: 23,
    min: 10,
    p50: 82,
    p80: 198,
    max: 330,
    stopScopeCounts: {
      section: 9,
      unknown: 14,
    },
    reliability: "sufficient",
  },
  major_accident: {
    count: 6,
    min: 28,
    p50: 435,
    p80: 614,
    max: 1575,
    stopScopeCounts: {
      section: 3,
      unknown: 3,
    },
    reliability: "sufficient",
  },
};

export const INCIDENT_TYPE_DURATIONS: IncidentTypeDurations = {
  person_collision: {
    groupId: "passenger",
    count: 51,
    min: 25,
    p50: 85,
    p80: 115,
    max: 255,
    stopScopeCounts: {
      section: 34,
      unknown: 17,
    },
    reliability: "sufficient",
  },
  medical_response: {
    groupId: "passenger",
    count: 0,
    min: null,
    p50: null,
    p80: null,
    max: null,
    stopScopeCounts: {},
    reliability: "use_group",
  },
  passenger_conflict: {
    groupId: "passenger",
    count: 0,
    min: null,
    p50: null,
    p80: null,
    max: null,
    stopScopeCounts: {},
    reliability: "use_group",
  },
  track_intrusion: {
    groupId: "passenger",
    count: 2,
    min: 23,
    p50: 39,
    p80: 49,
    max: 55,
    stopScopeCounts: {
      section: 2,
    },
    reliability: "use_group",
  },
  suspicious_object: {
    groupId: "passenger",
    count: 0,
    min: null,
    p50: null,
    p80: null,
    max: null,
    stopScopeCounts: {},
    reliability: "use_group",
  },
  vehicle_failure: {
    groupId: "vehicle",
    count: 6,
    min: 52,
    p50: 83,
    p80: 96,
    max: 140,
    stopScopeCounts: {
      section: 2,
      unknown: 4,
    },
    reliability: "sufficient",
  },
  vehicle_smoke: {
    groupId: "vehicle",
    count: 1,
    min: 92,
    p50: 92,
    p80: 92,
    max: 92,
    stopScopeCounts: {
      unknown: 1,
    },
    reliability: "use_group",
  },
  signal_failure: {
    groupId: "signaling",
    count: 8,
    min: 70,
    p50: 169,
    p80: 287,
    max: 531,
    stopScopeCounts: {
      section: 4,
      unknown: 4,
    },
    reliability: "sufficient",
  },
  point_failure: {
    groupId: "signaling",
    count: 1,
    min: 190,
    p50: 190,
    p80: 190,
    max: 190,
    stopScopeCounts: {
      unknown: 1,
    },
    reliability: "use_group",
  },
  power_outage: {
    groupId: "power",
    count: 4,
    min: 15,
    p50: 268,
    p80: 489,
    max: 510,
    stopScopeCounts: {
      section: 2,
      unknown: 2,
    },
    reliability: "use_group",
  },
  vegetation_obstruction: {
    groupId: "obstruction",
    count: 7,
    min: 20,
    p50: 140,
    p80: 216,
    max: 325,
    stopScopeCounts: {
      section: 4,
      unknown: 3,
    },
    reliability: "sufficient",
  },
  foreign_object: {
    groupId: "obstruction",
    count: 11,
    min: 20,
    p50: 73,
    p80: 120,
    max: 250,
    stopScopeCounts: {
      section: 9,
      unknown: 2,
    },
    reliability: "sufficient",
  },
  animal_collision: {
    groupId: "obstruction",
    count: 3,
    min: 75,
    p50: 75,
    p80: 124,
    max: 156,
    stopScopeCounts: {
      section: 2,
      unknown: 1,
    },
    reliability: "use_group",
  },
  crossing_obstruction: {
    groupId: "obstruction",
    count: 3,
    min: 10,
    p50: 50,
    p80: 104,
    max: 140,
    stopScopeCounts: {
      section: 3,
    },
    reliability: "use_group",
  },
  track_structure_damage: {
    groupId: "infrastructure",
    count: 4,
    min: 50,
    p50: 141,
    p80: 229,
    max: 329,
    stopScopeCounts: {
      section: 3,
      unknown: 1,
    },
    reliability: "use_group",
  },
  building_falling_object: {
    groupId: "infrastructure",
    count: 2,
    min: 49,
    p50: 68,
    p80: 79,
    max: 86,
    stopScopeCounts: {
      unknown: 2,
    },
    reliability: "use_group",
  },
  bridge_impact: {
    groupId: "infrastructure",
    count: 1,
    min: 225,
    p50: 225,
    p80: 225,
    max: 225,
    stopScopeCounts: {
      unknown: 1,
    },
    reliability: "use_group",
  },
  track_smoke_check: {
    groupId: "infrastructure",
    count: 7,
    min: 27,
    p50: 74,
    p80: 137,
    max: 190,
    stopScopeCounts: {
      section: 6,
      unknown: 1,
    },
    reliability: "sufficient",
  },
  heat_rail_deformation: {
    groupId: "infrastructure",
    count: 1,
    min: 375,
    p50: 375,
    p80: 375,
    max: 375,
    stopScopeCounts: {
      unknown: 1,
    },
    reliability: "use_group",
  },
  heavy_rain: {
    groupId: "weather",
    count: 11,
    min: 34,
    p50: 135,
    p80: 220,
    max: 290,
    stopScopeCounts: {
      section: 7,
      unknown: 4,
    },
    reliability: "sufficient",
  },
  strong_wind: {
    groupId: "weather",
    count: 7,
    min: 10,
    p50: 70,
    p80: 228,
    max: 330,
    stopScopeCounts: {
      section: 1,
      unknown: 6,
    },
    reliability: "sufficient",
  },
  earthquake: {
    groupId: "weather",
    count: 1,
    min: 20,
    p50: 20,
    p80: 20,
    max: 20,
    stopScopeCounts: {
      unknown: 1,
    },
    reliability: "use_group",
  },
  lightning: {
    groupId: "weather",
    count: 3,
    min: 37,
    p50: 60,
    p80: 88,
    max: 106,
    stopScopeCounts: {
      section: 1,
      unknown: 2,
    },
    reliability: "use_group",
  },
  snow_ice: {
    groupId: "weather",
    count: 1,
    min: 85,
    p50: 85,
    p80: 85,
    max: 85,
    stopScopeCounts: {
      unknown: 1,
    },
    reliability: "use_group",
  },
  crossing_collision: {
    groupId: "major_accident",
    count: 4,
    min: 52,
    p50: 435,
    p80: 570,
    max: 614,
    stopScopeCounts: {
      section: 3,
      unknown: 1,
    },
    reliability: "use_group",
  },
  derailment: {
    groupId: "major_accident",
    count: 1,
    min: 1575,
    p50: 1575,
    p80: 1575,
    max: 1575,
    stopScopeCounts: {
      unknown: 1,
    },
    reliability: "use_group",
  },
  onboard_fire: {
    groupId: "major_accident",
    count: 1,
    min: 28,
    p50: 28,
    p80: 28,
    max: 28,
    stopScopeCounts: {
      unknown: 1,
    },
    reliability: "use_group",
  },
};

// 種類ごとに、発表で使われる一般的な呼び名。実際の発表文は写さない
// 出典: 開発者の推定。一般に使われる呼び名の目安

import type { IncidentTypeId } from "./incident-durations.ts";

export const INCIDENT_PHRASES: Readonly<Record<IncidentTypeId, readonly string[]>> = {
  person_collision: ["人身事故", "人と接触", "人との接触", "お客様と接触"],
  medical_response: ["急病人", "急病のお客様", "お客様の救護", "救護活動"],
  passenger_conflict: [
    "お客様同士のトラブル",
    "車内でのトラブル",
    "車内トラブル",
    "お客様トラブル",
  ],
  track_intrusion: ["線路内立ち入り", "線路内に人が立ち入", "線路内への立ち入り", "線路に人が"],
  suspicious_object: ["不審物"],
  vehicle_failure: ["車両故障", "車両の故障", "車両点検", "車両の点検", "車両の不具合"],
  vehicle_smoke: ["車両から煙", "車両の発煙", "車両から発煙", "床下から煙"],
  signal_failure: ["信号故障", "信号トラブル", "信号の故障", "信号設備", "信号関係の故障"],
  point_failure: ["ポイント故障", "ポイントの故障", "ポイントの不具合", "ポイント不転換"],
  power_outage: ["停電", "送電", "架線に電気が"],
  vegetation_obstruction: ["倒木", "木が倒れ", "樹木と接触", "竹が"],
  foreign_object: ["架線に異物", "線路内に支障物", "線路上の支障物", "飛来物", "架線支障"],
  animal_collision: ["動物と衝突", "動物との衝突", "動物と接触", "鹿と衝突", "イノシシと衝突"],
  crossing_obstruction: ["踏切内で車が立ち往生", "踏切内に車", "踏切支障", "踏切内の自動車"],
  track_structure_damage: ["線路設備の点検", "線路の損傷", "線路設備の不具合", "レールの破損"],
  building_falling_object: ["コンクリート片", "落下物", "設備の落下"],
  bridge_impact: ["橋げた", "橋桁"],
  track_smoke_check: [
    "線路付近で発煙",
    "線路付近の火災",
    "沿線火災",
    "沿線で火災",
    "線路付近から煙",
  ],
  heat_rail_deformation: ["レールの変形", "レールのゆがみ", "レールの歪み", "暑さによる"],
  heavy_rain: ["大雨", "雨量計", "雨量規制", "降雨"],
  strong_wind: ["強風", "風速計", "風規制", "台風"],
  earthquake: ["地震"],
  lightning: ["落雷", "雷の影響"],
  snow_ice: ["降雪", "積雪", "雪の影響", "凍結"],
  crossing_collision: ["踏切で車と衝突", "踏切で自動車と衝突", "踏切事故", "踏切内で衝突"],
  derailment: ["脱線"],
  onboard_fire: ["車内で火", "車内で発火", "車内火災", "車内で出火"],
};

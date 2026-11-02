import { OSAKA_CITY_TAXI_FARE, OSAKA_CITY_TAXI_FARE_LABEL } from "../params/taxi.ts";
import { getJstMinuteOfDay } from "./time.ts";

// タクシー運賃の概算。距離制運賃のみを扱う
// 時間距離併用制（低速走行の加算）、迎車料金、有料道路代、各種割引は扱わない
// 深夜早朝割増は乗車開始時刻だけで判定する

export type TaxiFare = {
  fareYen: number;
  isNightSurcharge: boolean;
  source: string;
};

type DistanceFare = {
  initialDistanceMeters: number;
  initialFareYen: number;
  additionalDistanceMeters: number;
  additionalFareYen: number;
};

// 乗車開始が深夜早朝割増の時間帯（午後10時以降午前5時まで）にあるか
export function checkNightSurcharge(departureIso: string): boolean {
  const { startHour, endHour } = OSAKA_CITY_TAXI_FARE.nightSurcharge;
  const minute = getJstMinuteOfDay(departureIso);
  return minute >= startHour * 60 || minute < endHour * 60;
}

// 距離短縮方式の割増。初乗距離と加算距離を (1 + 割増率) で割り、1 m 単位に四捨五入する
export function applyDistanceShortening(fare: DistanceFare, rate: number): DistanceFare {
  return {
    ...fare,
    initialDistanceMeters: Math.round(fare.initialDistanceMeters / (1 + rate)),
    additionalDistanceMeters: Math.round(fare.additionalDistanceMeters / (1 + rate)),
  };
}

// 距離制運賃。初乗距離を超えたら加算距離ごとに加算運賃を足す
export function computeDistanceFare(distanceMeters: number, fare: DistanceFare): number {
  const excess = Math.max(distanceMeters - fare.initialDistanceMeters, 0);
  const steps = Math.ceil(excess / fare.additionalDistanceMeters);
  return fare.initialFareYen + steps * fare.additionalFareYen;
}

// 走行距離（km）と乗車開始時刻から大阪市域交通圏の概算運賃を返す
export function computeTaxiFare(distanceKm: number, departureIso: string): TaxiFare {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new RangeError(`距離は 0 以上の有限値: ${distanceKm}`);
  }
  const isNightSurcharge = checkNightSurcharge(departureIso);
  const fare = isNightSurcharge
    ? applyDistanceShortening(OSAKA_CITY_TAXI_FARE, OSAKA_CITY_TAXI_FARE.nightSurcharge.rate)
    : OSAKA_CITY_TAXI_FARE;
  return {
    fareYen: computeDistanceFare(Math.round(distanceKm * 1000), fare),
    isNightSurcharge,
    source: OSAKA_CITY_TAXI_FARE_LABEL,
  };
}

import type { InCarGuide } from "@repo/schema";

// 駅の間の車内の人に、地図に重ねる帯の表示用の値。時刻は判断の結果のものだけを使い、帯の上の位置だけを求める
// 横軸は動き出す見込みの早い側から、遅い側か次の駅に着く時刻の遅いほうまで

export type InCarBand = {
  // 軸の両端の時刻
  start: string;
  end: string;
  // 動き出す見込みの幅。軸の上の位置を 0〜1 で持つ
  departure: { from: number; to: number; early: string; late: string | null };
  // 次の駅に着く見込みの時刻の位置。見込みが無ければ null
  arrival: { x: number; time: string; station: string } | null;
};

function placeOnAxis(startMs: number, spanMs: number, iso: string): number {
  if (spanMs <= 0) return 0;
  return Math.min(1, Math.max(0, (Date.parse(iso) - startMs) / spanMs));
}

// 動き出す見込みが無ければ null。線路に降りる案内のときがこれに当たる
export function buildInCarBand(guide: InCarGuide): InCarBand | null {
  if (!guide.departure) return null;
  const late = guide.departureP80 ?? null;
  const arrival =
    guide.alightArrival && guide.alightStation
      ? { time: guide.alightArrival, station: guide.alightStation }
      : null;
  const ends = [guide.departure, late, arrival?.time].filter((t): t is string => Boolean(t));
  const end = ends.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
  const startMs = Date.parse(guide.departure);
  const spanMs = Date.parse(end) - startMs;
  return {
    start: guide.departure,
    end,
    departure: {
      from: 0,
      to: late ? placeOnAxis(startMs, spanMs, late) : 0,
      early: guide.departure,
      late,
    },
    arrival: arrival ? { ...arrival, x: placeOnAxis(startMs, spanMs, arrival.time) } : null,
  };
}

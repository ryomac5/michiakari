import { NextResponse } from "next/server";
import { loadReachIndex } from "@/features/map/load-reach-index";
import { findReachAreas } from "@/features/map/reach";

// 現在地の駅の、徒歩 10 分と 20 分の到達範囲を返す。範囲が無い駅は空の配列
export function GET(request: Request) {
  const station = (new URL(request.url).searchParams.get("station") ?? "").slice(0, 40);
  return NextResponse.json(findReachAreas(loadReachIndex(), station), {
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}

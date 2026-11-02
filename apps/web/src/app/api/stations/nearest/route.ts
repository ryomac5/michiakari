import { NextResponse } from "next/server";
import { findNearestChoices, LocationRequestSchema } from "@/features/stations/catalog";
import { loadStationCatalog } from "@/features/stations/load-station-catalog";

// 現在地から最寄りの駅を返す。位置は URL に載せないよう POST の本文で受け、保存もログ出力もしない
export async function POST(request: Request) {
  const parsed = LocationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_location" }, { status: 400 });
  }
  const { index, catalog } = loadStationCatalog();
  return NextResponse.json(
    { nearest: findNearestChoices(index, catalog, parsed.data) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

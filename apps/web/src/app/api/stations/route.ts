import { NextResponse } from "next/server";
import { searchStationChoices } from "@/features/stations/catalog";
import { loadStationCatalog } from "@/features/stations/load-station-catalog";

// 駅名の検索。国土数値情報の駅を、同名で近くにある駅どうしまとめて返す
export function GET(request: Request) {
  const query = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 40);
  const { index, catalog } = loadStationCatalog();
  return NextResponse.json(
    { stations: searchStationChoices(index, catalog, query) },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}

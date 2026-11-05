import { defaultSpeed, resolveSpeedParam } from "@/features/replay/clock";
import { loadReplayScenarios } from "@/features/replay/load-scenarios";
import { describeStationNames } from "@/features/stations/catalog";
import { loadStationCatalog } from "@/features/stations/load-station-catalog";
import { ReplayScreen } from "@/screens/ReplayScreen";

// ?scenario= で最初に開くシナリオ、?speed= で再生速度を指定できる（録画とテスト用）
export default async function ReplayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const scenario = typeof params.scenario === "string" ? params.scenario : null;
  const speed = typeof params.speed === "string" ? params.speed : null;

  const scenarios = loadReplayScenarios();
  // 英語画面でシナリオの駅名をローマ字で出すため、駅名の対応だけを渡す
  const stationNames = describeStationNames(
    loadStationCatalog().catalog,
    scenarios.flatMap((s) => [s.user.current_station, s.user.destination]),
  );

  return (
    <ReplayScreen
      scenarios={scenarios}
      stationNames={stationNames}
      initialScenarioId={scenario}
      initialSpeed={resolveSpeedParam(speed) ?? defaultSpeed}
    />
  );
}

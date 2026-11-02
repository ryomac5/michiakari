import { defaultSpeed, resolveSpeedParam } from "@/features/replay/clock";
import { loadReplayScenarios } from "@/features/replay/load-scenarios";
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

  return (
    <ReplayScreen
      scenarios={loadReplayScenarios()}
      initialScenarioId={scenario}
      initialSpeed={resolveSpeedParam(speed) ?? defaultSpeed}
    />
  );
}

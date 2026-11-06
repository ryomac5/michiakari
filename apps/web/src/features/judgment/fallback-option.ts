import { selectBestAlternative } from "@repo/core";
import type { Judgment } from "@repo/schema";

// 待つ判断で、動かなかったときに乗る選択肢。見出しの「動かなければ◯◯へ」と同じ選択肢を指す
// 勧める代替手段の決まりは core の 1 か所に置き、ここでは引くだけにする
// 切り替えの判断、境目の無い判断、駅間の車内では null にする
export function selectFallbackOptionId(
  judgment: Judgment | null,
  deadline: string | null = null,
): string | null {
  if (!judgment || judgment.action === "switch" || judgment.breakEven === null) return null;
  if (judgment.inCar) return null;
  const alternatives = judgment.options.filter((o) => o.kind !== "wait");
  return selectBestAlternative(alternatives, deadline)?.id ?? null;
}

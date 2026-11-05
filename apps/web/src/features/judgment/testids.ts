import { testIds as sharedTestIds } from "../../lib/testids";

export type { SituationTab } from "../../lib/testids";

export const testIds = {
  ...sharedTestIds,
  judgment: {
    ...sharedTestIds.judgment,
    conclusionReasonDetail: "judgment-conclusion-reason-detail",
    // 待つ見出しの 2 文目。「動かなければ阪急京都線へ」
    conclusionNext: "judgment-conclusion-next",
    // 見込みの確かさ。data-level に low / medium / high を出す
    confidence: "judgment-confidence",
    // 再開の見込みの図の右上の「発生から28分」
    resumeChanceOnset: "judgment-resume-chance-onset",
    // 図の下の「22:55までに動けば間に合う」。到着の期限ではなく、間に合うための再開の時刻
    resumeChanceResumeBy: "judgment-resume-chance-resume-by",
  },
  start: {
    ...sharedTestIds.start,
    intro: "start-intro",
    routeSummary: "start-route-summary",
    trainLineSearch: "start-train-line-search",
    trainSegment: "start-train-segment",
    introAudience: "start-intro-audience",
    introProblem: "start-intro-problem",
    introSolution: "start-intro-solution",
    nearbyStation: (id: string) => `start-nearby-station-${id}`,
  },
};

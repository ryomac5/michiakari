import { testIds as sharedTestIds } from "../../lib/testids";

export type { SituationTab } from "../../lib/testids";

export const testIds = {
  ...sharedTestIds,
  judgment: {
    ...sharedTestIds.judgment,
    conclusionReasonDetail: "judgment-conclusion-reason-detail",
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

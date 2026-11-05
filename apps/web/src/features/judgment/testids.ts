import { testIds as sharedTestIds } from "../../lib/testids";

export type { SituationTab } from "../../lib/testids";

export const testIds = {
  ...sharedTestIds,
  start: {
    ...sharedTestIds.start,
    intro: "start-intro",
    introAudience: "start-intro-audience",
    introProblem: "start-intro-problem",
    introSolution: "start-intro-solution",
    nearbyStation: (id: string) => `start-nearby-station-${id}`,
  },
};

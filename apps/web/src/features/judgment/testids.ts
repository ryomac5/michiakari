import { testIds as sharedTestIds } from "../../lib/testids";

export type { SituationTab } from "../../lib/testids";

export const testIds = {
  ...sharedTestIds,
  start: {
    ...sharedTestIds.start,
    nearbyStation: (id: string) => `start-nearby-station-${id}`,
  },
};

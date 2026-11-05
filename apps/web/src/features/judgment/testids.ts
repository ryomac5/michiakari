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
    // 現在地から読み取る。data-status に読み取りの状態を出す
    gps: "start-gps",
    gpsLocate: "start-gps-locate",
    gpsQuestion: "start-gps-question",
    gpsConfirm: "start-gps-confirm",
    gpsDismiss: "start-gps-dismiss",
    gpsChoice: (key: string) => `start-gps-choice-${key}`,
    gpsStatus: "start-gps-status",
  },
};

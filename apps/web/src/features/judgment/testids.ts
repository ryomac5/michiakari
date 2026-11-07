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
    // 近くのバス停の確認候補の欄。時刻は出さない
    busChecks: "judgment-bus-checks",
    busCheck: (id: string) => `judgment-bus-check-${id}`,
    // 防護無線の事象の 1 行の読み。見出しの下に出す
    protection: "judgment-protection",
    // 電車の中の判断で、止まった理由の 1 行。data-reason に理由を出す
    stopReason: "judgment-stop-reason",
    // 規則から出した見込みの欄。支障の無い線路と再開後の詰まり
    ruleOutlook: "judgment-rule-outlook",
    // 支障の無い線路の行。side は opposite か affected
    trackLine: (side: string) => `judgment-track-line-${side}`,
    queueWait: "judgment-queue-wait",
    // 次の駅で降りて乗り換える行。data-option-id に乗り換え先の選択肢を出す
    queueAlight: "judgment-queue-alight",
  },
  start: {
    ...sharedTestIds.start,
    intro: "start-intro",
    routeSummary: "start-route-summary",
    trainLineSearch: "start-train-line-search",
    trainSegment: "start-train-segment",
    introClose: "start-intro-close",
    mapPick: "start-map-pick",
    introAudience: "start-intro-audience",
    introProblem: "start-intro-problem",
    introSolution: "start-intro-solution",
    nearbyStation: (id: string) => `start-nearby-station-${id}`,
    // 行き先の段で、先に路線を選ぶ一覧のチップ
    routeLine: (key: string) => `start-route-line-${key}`,
    // 地図の上の、車内の駅の間の丸。key は「前の駅~次の駅」。data-selected に選んでいるかを出す
    mapSegment: (key: string) => `start-map-segment-${key}`,
    // 現在地から読み取る。data-status に読み取りの状態を出す
    gps: "start-gps",
    gpsLocate: "start-gps-locate",
    gpsQuestion: "start-gps-question",
    tapRipple: "start-tap-ripple",
    gpsConfirm: "start-gps-confirm",
    gpsDismiss: "start-gps-dismiss",
    gpsChoice: (key: string) => `start-gps-choice-${key}`,
    gpsStatus: "start-gps-status",
  },
};

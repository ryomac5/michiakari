// data-testid の一覧。リプレイ（WS7）と録画が使うので、値を変えるときは e2e も直す
// e2e からも相対パスで読むので、このファイルは何も import しない
// 命名規則: <画面>-<領域>[-<要素>]。すべて kebab-case
//   画面: app（共通）/ start / situation / judgment / replay / about
//   一覧の要素は末尾に -<id> を付ける（例: judgment-option-transfer_hankyu）
//   状態は data-state・data-action などの属性で表し、testid には含めない

export const testIds = {
  app: {
    header: "app-header",
    homeLink: "app-home-link",
    aboutLink: "app-about-link",
    languageSwitch: "app-language-switch",
    language: (locale: string) => `app-language-${locale}`,
    themeToggle: "app-theme-toggle",
    mockBadge: "app-mock-badge",
    menuButton: "app-menu-button",
    menu: "app-menu",
    // 入口やリプレイの一覧の背景の地図。data-state が ready なら路線を描き終えている
    backdropMap: "app-backdrop-map",
  },
  // 入口。地図で駅を選び、同じ地図の上のシートで状況まで入れる。data-stage に段を出す
  start: {
    screen: "start-screen",
    map: "start-map",
    prompt: "start-prompt",
    hub: (areaId: string) => `start-hub-${areaId}`,
    // 狭い画面で見える範囲の外にある丸の、縁の札
    hubEdge: (areaId: string) => `start-hub-edge-${areaId}`,
    place: (key: string) => `start-place-${key}`,
    destinationPin: "start-destination-pin",
    // PC 幅の問いかけの下の、よく使う駅
    quickPick: (areaId: string) => `start-quick-pick-${areaId}`,
    sheet: "start-sheet",
    back: "start-back",
    areaPlace: (key: string) => `start-area-place-${key}`,
    line: (key: string) => `start-line-${key}`,
    originSearch: "start-origin-search",
    originOption: (id: string) => `start-origin-option-${id}`,
    locateButton: "start-locate-button",
    locateStatus: "start-locate-status",
    destinationSearch: "start-destination-search",
    destinationOption: (id: string) => `start-destination-option-${id}`,
    // 進み具合の印。data-step に今の段の番号（0 から）を出す
    progress: "start-progress",
    direction: (key: string) => `start-direction-${key}`,
    // 地図の上の、方面・行き先・近い駅の札
    mapStop: (key: string) => `start-map-stop-${key}`,
    destinationUndecided: "start-destination-undecided",
    // 方面の先の行き先の候補。data-operator に事業者名を出す
    destinationCandidate: (id: string) => `start-destination-candidate-${id}`,
    positionStation: "start-position-station",
    // 電車の中・駅に止まっている。押すと止まっている駅を聞く
    positionTrain: "start-position-train",
    // 電車の中・駅と駅の間。押すと既定値で先へ進む
    positionBetween: "start-position-between",
    nearStop: (id: string) => `start-near-stop-${id}`,
    // 様子の 3 つの問い。原因、止まってからの時間、再開の見込み
    cause: (id: string) => `start-cause-${id}`,
    // 原因の大分類の続きで聞く種類
    causeKind: (id: string) => `start-cause-kind-${id}`,
    elapsed: (id: string) => `start-elapsed-${id}`,
    resume: (id: string) => `start-resume-${id}`,
    // 放送で聞いた再開見込みの時刻。id は HHMM
    resumeTime: (id: string) => `start-resume-time-${id}`,
    // 答えたことを示すチップ。押すとその問いへ戻る
    answer: (kind: "cause" | "elapsed") => `start-answer-${kind}`,
    trip: "start-trip",
    editLine: "start-edit-line",
    editDestination: "start-edit-destination",
    // 発表文や掲示を持っている人向けの、撮る・貼るの小さな入口
    method: (kind: Exclude<SituationTab, "select">) => `start-method-${kind}`,
    replayLink: "start-replay-link",
  },
  situation: {
    screen: "situation-screen",
    tripSummary: "situation-trip-summary",
    tabs: "situation-tabs",
    tab: (kind: SituationTab) => `situation-tab-${kind}`,
    photoInput: "situation-photo-input",
    photoButton: "situation-photo-button",
    photoPreview: "situation-photo-preview",
    pasteInput: "situation-paste-input",
    eventTypeOption: (id: string) => `situation-event-type-${id}`,
    signalOption: (id: string) => `situation-signal-${id}`,
    selectionEmpty: "situation-selection-empty",
    submit: (kind: SituationTab) => `situation-submit-${kind}`,
    inputError: "situation-input-error",
  },
  judgment: {
    screen: "judgment-screen",
    // 上部の帯の左端の「戻る」。入口の最後に答えた段へ戻る
    backButton: "judgment-back-button",
    tripSummary: "judgment-trip-summary",
    // 上部の帯の「JR京都線 見合わせ」
    statusChip: "judgment-status-chip",
    // 駅間の車内の人への案内。着いた後の次の一手と、係員の案内に従う一文
    inCar: "judgment-in-car",
    inCarAfterAlight: "judgment-in-car-after-alight",
    inCarStaffNote: "judgment-in-car-staff-note",
    // 地図の上のシート（PC 幅では右のパネル）。data-snap に collapsed / half / full を出す
    sheet: "judgment-sheet",
    sheetHandle: "judgment-sheet-handle",
    reasoning: "judgment-reasoning",
    reasoningStep: (id: string) => `judgment-reasoning-step-${id}`,
    reasoningProgress: (id: string) => `judgment-reasoning-progress-${id}`,
    // 判断が出たあとに全部開いた状態で見せる推論の過程
    reasoningLog: "judgment-reasoning-log",
    // 駅と駅の間の人の前提のチップ。data-source に default / user を出す
    trainPosition: "judgment-train-position",
    trainPositionChip: (kind: "next" | "own" | "ahead") => `judgment-train-position-chip-${kind}`,
    trainPositionEditor: "judgment-train-position-editor",
    trainPositionNext: (id: string) => `judgment-train-position-next-${id}`,
    trainPositionType: (id: string) => `judgment-train-position-type-${id}`,
    trainPositionAheadAdd: (id: string) => `judgment-train-position-ahead-add-${id}`,
    trainPositionAheadItem: (id: string) => `judgment-train-position-ahead-item-${id}`,
    trainPositionAheadRemove: "judgment-train-position-ahead-remove",
    trainPositionAheadNone: "judgment-train-position-ahead-none",
    trainPositionAheadUnknown: "judgment-train-position-ahead-unknown",
    trainPositionApply: "judgment-train-position-apply",
    trainPositionHint: "judgment-train-position-hint",
    conclusion: "judgment-conclusion",
    conclusionHeadline: "judgment-conclusion-headline",
    conclusionReason: "judgment-conclusion-reason",
    change: "judgment-change",
    changeBefore: "judgment-change-before",
    changeAfter: "judgment-change-after",
    changeAnnouncement: "judgment-change-announcement",
    changeProbability: "judgment-change-probability",
    disclaimer: "judgment-disclaimer",
    error: "judgment-error",
    retryButton: "judgment-retry-button",
    breakEven: "judgment-break-even",
    breakEvenTime: "judgment-break-even-time",
    breakEvenCountdown: "judgment-break-even-countdown",
    // 切り替えの判断で、分岐点と残り時間の代わりに出す「阪急京都線 大阪梅田まで徒歩 9 分・00:14 着」
    switchStep: "judgment-switch-step",
    // 閉じたシートの再開の見込み。確率の帯があれば帯と要点の一文、無ければ「おおよその再開 23:43〜23:58 は分岐点より後」。data-relation を出す
    breakEvenResume: "judgment-break-even-resume",
    // 時刻ごとの再開の見込みの帯。data-step・data-wait-faster・data-wait-on-time・data-onset を出す
    resumeChance: "judgment-resume-chance",
    // 「1時間20分後の 23:30 には、6割の見込みで動いています」。data-time に目盛りの時刻を出す
    resumeChanceLead: "judgment-resume-chance-lead",
    // 帯の目盛り。id は日本時間の HHMM。data-tenths・data-since-onset・data-side を出す
    resumeChanceTick: (hhmm: string) => `judgment-resume-chance-tick-${hhmm}`,
    // 待ったほうが早く着く見込みと、待って期限に間に合う見込み。data-tenths を出す
    resumeChanceWaitFaster: "judgment-resume-chance-wait-faster",
    resumeChanceWaitOnTime: "judgment-resume-chance-wait-on-time",
    // 帯の上の分岐点と期限の印。data-time と data-label-side を出す
    resumeChanceBreakEven: "judgment-resume-chance-break-even",
    resumeChanceDeadline: "judgment-resume-chance-deadline",
    // 「21:40 までに再開しなければ…」の文
    breakEvenSentence: "judgment-break-even-sentence",
    // 分岐点の時間軸。data-relation に before / straddle / after を出す
    breakEvenTimeline: "judgment-break-even-timeline",
    map: "judgment-map",
    options: "judgment-options",
    option: (id: string) => `judgment-option-${id}`,
    evidence: "judgment-evidence",
    evidenceToggle: "judgment-evidence-toggle",
    // 根拠の項目。id は兆候か事象の id。data-phase-id と data-current を出す
    evidenceItem: (id: string) => `judgment-evidence-item-${id}`,
    evidenceHeard: "judgment-evidence-heard",
    evidenceReading: "judgment-evidence-reading",
    // 判断に使った雨量の推移。data-trend と data-reading-count（欠測を含む観測の数）を出す
    weather: "judgment-weather",
    weatherChart: "judgment-weather-chart",
    weatherTrend: "judgment-weather-trend",
    weatherWarnings: "judgment-weather-warnings",
    weatherMissing: "judgment-weather-missing",
    weatherSummary: "judgment-weather-summary",
    weatherFictional: "judgment-weather-fictional",
    addInfo: "judgment-add-info",
    // 入口で方面だけ・電車の中・分からないで進んだときの前提と、次に確かめること
    premise: "judgment-premise",
    nextCheck: "judgment-next-check",
    nextCheckAction: "judgment-next-check-action",
  },
  // リプレイ。判断の部品は judgment の testid をそのまま使う
  replay: {
    screen: "replay-screen",
    scenarioList: "replay-scenario-list",
    scenario: (id: string) => `replay-scenario-${id}`,
    backButton: "replay-back-button",
    bar: "replay-bar",
    title: "replay-title",
    playButton: "replay-play-button",
    nextButton: "replay-next-button",
    restartButton: "replay-restart-button",
    speed: (speed: number) => `replay-speed-${speed}`,
    clock: "replay-clock",
    progress: "replay-progress",
    announcement: "replay-announcement",
    judgment: "replay-judgment",
    changeBadge: "replay-change-badge",
    history: "replay-history",
    historyItem: (observationId: string) => `replay-history-item-${observationId}`,
    // 結末の比較。data-followed-arrival / data-waited-arrival / data-diff-minutes に値を出す
    outcome: "replay-outcome",
    outcomeSummary: "replay-outcome-summary",
    outcomeFollowed: "replay-outcome-followed",
    outcomeCounterpart: "replay-outcome-counterpart",
  },
  // 見つからない頁と、思わぬエラーの画面。data-kind に notFound / error を出す
  status: {
    screen: "status-screen",
    home: "status-home",
    retry: "status-retry",
  },
  about: {
    screen: "about-screen",
    // 作った理由
    why: "about-why",
    attribution: "about-attribution",
  },
} as const;

export type SituationTab = "photo" | "paste" | "select";

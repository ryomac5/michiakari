// data-testid の一覧。リプレイ（WS7）と録画が使うので、値を変えるときは e2e も直す
// e2e からも相対パスで読むので、このファイルは何も import しない
// 命名規則: <画面>-<領域>[-<要素>]。すべて kebab-case
//   画面: app（共通）/ start / situation / judgment / replay / about / knowledge
//   一覧の要素は末尾に -<id> を付ける（例: judgment-option-transfer_hankyu）
//   状態は data-state・data-action などの属性で表し、testid には含めない

export const testIds = {
  app: {
    header: "app-header",
    homeLink: "app-home-link",
    aboutLink: "app-about-link",
    knowledgeLink: "app-knowledge-link",
    languageSwitch: "app-language-switch",
    language: (locale: string) => `app-language-${locale}`,
    themeToggle: "app-theme-toggle",
    mockBadge: "app-mock-badge",
    menuButton: "app-menu-button",
    menu: "app-menu",
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
    positionTrain: "start-position-train",
    nearStop: (id: string) => `start-near-stop-${id}`,
    cause: (id: string) => `start-cause-${id}`,
    elapsed: (id: string) => `start-elapsed-${id}`,
    trip: "start-trip",
    editLine: "start-edit-line",
    editDestination: "start-edit-destination",
    method: (kind: SituationTab) => `start-method-${kind}`,
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
    tripSummary: "judgment-trip-summary",
    // 上部の帯の「JR京都線 見合わせ」
    statusChip: "judgment-status-chip",
    // 地図の上のシート（PC 幅では右のパネル）。data-snap に collapsed / half / full を出す
    sheet: "judgment-sheet",
    sheetHandle: "judgment-sheet-handle",
    reasoning: "judgment-reasoning",
    reasoningStep: (id: string) => `judgment-reasoning-step-${id}`,
    reasoningProgress: (id: string) => `judgment-reasoning-progress-${id}`,
    // 判断が出たあとに全部開いた状態で見せる推論の過程
    reasoningLog: "judgment-reasoning-log",
    conclusion: "judgment-conclusion",
    conclusionHeadline: "judgment-conclusion-headline",
    conclusionReason: "judgment-conclusion-reason",
    disclaimer: "judgment-disclaimer",
    error: "judgment-error",
    retryButton: "judgment-retry-button",
    breakEven: "judgment-break-even",
    breakEvenTime: "judgment-break-even-time",
    breakEvenMeaning: "judgment-break-even-meaning",
    breakEvenCountdown: "judgment-break-even-countdown",
    // 切り替えの判断で、分岐点と残り時間の代わりに出す「阪急京都線 大阪梅田まで徒歩 9 分・00:14 着」
    switchStep: "judgment-switch-step",
    // 閉じたシートの「おおよその再開 23:43〜23:58 は分岐点より後」。data-relation を出す
    breakEvenResume: "judgment-break-even-resume",
    // 「21:40 までに再開しなければ…」の文
    breakEvenSentence: "judgment-break-even-sentence",
    // 分岐点の時間軸。data-relation に before / straddle / after を出す
    breakEvenTimeline: "judgment-break-even-timeline",
    map: "judgment-map",
    options: "judgment-options",
    option: (id: string) => `judgment-option-${id}`,
    evidence: "judgment-evidence",
    evidenceToggle: "judgment-evidence-toggle",
    // よくある流れ。data-event-type・data-phase-id・data-predictability・data-expanded を出す
    flow: "judgment-flow",
    flowPhase: (id: string) => `judgment-flow-phase-${id}`,
    phaseTimeline: "judgment-phase-timeline",
    phase: (id: string) => `judgment-phase-${id}`,
    signal: (id: string) => `judgment-signal-${id}`,
    signalLink: (id: string) => `judgment-signal-link-${id}`,
    evidenceItem: (id: string) => `judgment-evidence-item-${id}`,
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
    phaseStrip: "replay-phase-strip",
    phase: (id: string) => `replay-phase-${id}`,
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
    knowledgeLink: "about-knowledge-link",
  },
  // 知見ナレッジの閲覧画面
  knowledge: {
    screen: "knowledge-screen",
    notice: "knowledge-notice",
    dummyNotice: "knowledge-dummy-notice",
    event: (id: string) => `knowledge-event-${id}`,
    phase: (id: string) => `knowledge-phase-${id}`,
    signal: (id: string) => `knowledge-signal-${id}`,
    yaml: (id: string) => `knowledge-yaml-${id}`,
    caveats: (id: string) => `knowledge-caveats-${id}`,
    replayLink: (scenarioId: string) => `knowledge-replay-link-${scenarioId}`,
  },
} as const;

export type SituationTab = "photo" | "paste" | "select";

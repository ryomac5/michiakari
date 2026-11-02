// data-testid の一覧。リプレイ（WS7）と録画が使うので、値を変えるときは e2e も直す
// e2e からも相対パスで読むので、このファイルは何も import しない
// 命名規則: <画面>-<領域>[-<要素>]。すべて kebab-case
//   画面: app（共通）/ start / situation / judgment / about
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
  },
  start: {
    screen: "start-screen",
    originSearch: "start-origin-search",
    originOption: (id: string) => `start-origin-option-${id}`,
    originSelected: "start-origin-selected",
    originClear: "start-origin-clear",
    locateButton: "start-locate-button",
    locateStatus: "start-locate-status",
    destinationSearch: "start-destination-search",
    destinationOption: (id: string) => `start-destination-option-${id}`,
    destinationSelected: "start-destination-selected",
    destinationClear: "start-destination-clear",
    nextButton: "start-next-button",
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
    reasoning: "judgment-reasoning",
    reasoningStep: (id: string) => `judgment-reasoning-step-${id}`,
    conclusion: "judgment-conclusion",
    conclusionHeadline: "judgment-conclusion-headline",
    disclaimer: "judgment-disclaimer",
    error: "judgment-error",
    retryButton: "judgment-retry-button",
    breakEven: "judgment-break-even",
    breakEvenTime: "judgment-break-even-time",
    breakEvenCountdown: "judgment-break-even-countdown",
    map: "judgment-map",
    options: "judgment-options",
    option: (id: string) => `judgment-option-${id}`,
    evidence: "judgment-evidence",
    evidenceToggle: "judgment-evidence-toggle",
    phaseTimeline: "judgment-phase-timeline",
    phase: (id: string) => `judgment-phase-${id}`,
    signal: (id: string) => `judgment-signal-${id}`,
    evidenceItem: (id: string) => `judgment-evidence-item-${id}`,
    addInfo: "judgment-add-info",
  },
  about: {
    screen: "about-screen",
    attribution: "about-attribution",
  },
} as const;

export type SituationTab = "photo" | "paste" | "select";

// 地図の data-testid。命名規則は features/judgment/testids.ts に従う
// e2e からも相対パスで読むので、このファイルは何も import しない
// 地図の枠そのものは testIds.judgment.map（judgment-map）を使う

export const mapTestIds = {
  canvas: "judgment-map-canvas",
  legend: "judgment-map-legend",
  reachApprox: "judgment-map-reach-approx",
  attribution: "judgment-map-attribution",
  attributionLine: "judgment-map-attribution-line",
  // 現在地のまわりと全体の切り替え。地図の枠の data-view に focus / overview を出す
  viewToggle: "judgment-map-view-toggle",
  // 乗り換え候補の駅の吹き出し。data-recommended・data-status・data-walk-minutes を出す
  station: (key: string) => `judgment-map-station-${key}`,
  here: "judgment-map-here",
  // 駅間の車内の人に出す、次に降りる駅の印
  alight: "judgment-map-alight",
  blockedTag: "judgment-map-blocked-tag",
  // 一覧で選んだ経路を描いているときの「表示中」の札
  selectedRoute: "judgment-map-selected-route",
  // 札が地図に収まらないときに、札を移す上端の一覧と、その駅の行
  labelList: "judgment-map-label-list",
  labelListRow: (key: string) => `judgment-map-label-list-row-${key}`,
} as const;

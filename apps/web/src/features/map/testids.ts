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
  // 待つ判断で、動かなかったときに乗る駅の吹き出しに付ける「動かなければ」の札
  fallbackTag: "judgment-map-fallback-tag",
  here: "judgment-map-here",
  // 駅間の車内の人に出す、次に降りる駅の印
  alight: "judgment-map-alight",
  // 発表で区間が分かったときだけ出す「見合わせ 大阪〜京都」の札
  blockedTag: "judgment-map-blocked-tag",
  // 発表に区間が無いときも出さない札。出ないことをテストで確かめるための識別子
  sectionNote: "judgment-map-section-note",
  // 一覧で選んだ経路を描いているときの「表示中」の札
  selectedRoute: "judgment-map-selected-route",
  // 札が地図に収まらないときに、札を移す上端の一覧と、その駅の行
  labelList: "judgment-map-label-list",
  labelListRow: (key: string) => `judgment-map-label-list-row-${key}`,
  // 車内の判断で、次の駅まで動く列車の印と、動きをもう一度見るボタン
  motionTrain: "judgment-map-motion-train",
  motionReplay: "judgment-map-motion-replay",
  // 行き先の印と、行き先が画面の外にあるときに縁に出す札
  destination: "judgment-map-destination",
  destinationEdge: "judgment-map-destination-edge",
} as const;

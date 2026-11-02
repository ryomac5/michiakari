// 地図の data-testid。命名規則は features/judgment/testids.ts に従う
// e2e からも相対パスで読むので、このファイルは何も import しない
// 地図の枠そのものは testIds.judgment.map（judgment-map）を使う

export const mapTestIds = {
  canvas: "judgment-map-canvas",
  legend: "judgment-map-legend",
  reachApprox: "judgment-map-reach-approx",
  attribution: "judgment-map-attribution",
  attributionLine: "judgment-map-attribution-line",
} as const;

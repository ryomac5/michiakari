// シード固定の擬似乱数と正規乱数。外部依存を持たない

export type Random = () => number;

// mulberry32。[0, 1) の一様乱数を返す関数を作る
export function createMulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// (0, 1] の一様乱数。対数を取っても発散しない
function drawOpenUniform(random: Random): number {
  return 1 - random();
}

// Box-Muller 法で標準正規乱数を 1 つ返す
export function sampleStandardNormal(random: Random): number {
  const r = Math.sqrt(-2 * Math.log(drawOpenUniform(random)));
  return r * Math.cos(2 * Math.PI * random());
}

// lower より大きい範囲に切断した標準正規乱数を返す
// lower ≤ 0 は棄却法、lower > 0 は Robert (1995) の指数分布による棄却法
export function sampleTruncatedStandardNormal(random: Random, lower: number): number {
  if (lower <= 0) {
    for (;;) {
      const z = sampleStandardNormal(random);
      if (z > lower) return z;
    }
  }
  const alpha = (lower + Math.sqrt(lower * lower + 4)) / 2;
  for (;;) {
    const z = lower - Math.log(drawOpenUniform(random)) / alpha;
    const rho = Math.exp(-((z - alpha) ** 2) / 2);
    if (random() <= rho) return z;
  }
}

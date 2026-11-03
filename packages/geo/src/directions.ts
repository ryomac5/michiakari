import type { LineInfo } from "./types.ts";

// 路線の方面。選んだ駅から見た路線の片側を、先の駅の並びで表す

export type LineDirection = {
  // 先の駅の ID。近い順に並べ、選んだ駅は含まない
  stationIds: string[];
  // 方面の終わりの駅の ID。環状線では一周の半分で切った先の駅
  terminalId: string;
  loop: boolean;
};

// 区間の端の駅から、同じ路線の別の区間へそのまま続く先を探す。分岐が複数あれば長いほうを選ぶ
function findContinuation(line: LineInfo, fromIndex: number, endId: string): string[] {
  let best: string[] = [];
  line.segments.forEach((segment, index) => {
    if (index === fromIndex || segment.loop) return;
    const ids = segment.stationIds;
    const next =
      ids[0] === endId ? ids.slice(1) : ids.at(-1) === endId ? ids.slice(0, -1).reverse() : [];
    if (next.length > best.length) best = next;
  });
  return best;
}

function buildLoopDirections(ids: string[], index: number): LineDirection[] {
  const others = [...ids.slice(index + 1), ...ids.slice(0, index)];
  const half = Math.ceil(others.length / 2);
  const forward = others.slice(0, half);
  const backward = [...others].reverse().slice(0, half);
  return [forward, backward]
    .filter((s) => s.length > 0)
    .map((stationIds) => ({ stationIds, terminalId: stationIds.at(-1) as string, loop: true }));
}

function buildSegmentDirections(line: LineInfo, segmentIndex: number, index: number) {
  const ids = line.segments[segmentIndex]?.stationIds ?? [];
  const sides = [ids.slice(index + 1), ids.slice(0, index).reverse()];
  return sides
    .filter((s) => s.length > 0)
    .map((side) => {
      const seen = new Set([ids[index], ...side]);
      const tail = findContinuation(line, segmentIndex, side.at(-1) as string).filter(
        (id) => !seen.has(id),
      );
      const stationIds = [...side, ...tail];
      return { stationIds, terminalId: stationIds.at(-1) as string, loop: false };
    });
}

function isPrefixOf(a: string[], b: string[]): boolean {
  return a.length <= b.length && a.every((id, i) => b[i] === id);
}

// 選んだ駅から見た路線の方面を返す。区間の分かれ目では、続く区間をつないで 1 つの方面にする
// 先が 1 駅だけの短い支線は、ほかに 2 つ以上の方面があれば除く
export function listLineDirections(line: LineInfo, stationId: string): LineDirection[] {
  const found: LineDirection[] = [];
  line.segments.forEach((segment, segmentIndex) => {
    const index = segment.stationIds.indexOf(stationId);
    if (index < 0) return;
    found.push(
      ...(segment.loop
        ? buildLoopDirections(segment.stationIds, index)
        : buildSegmentDirections(line, segmentIndex, index)),
    );
  });
  const unique = found.filter(
    (d, i) =>
      !found.some(
        (o, j) =>
          j !== i &&
          isPrefixOf(d.stationIds, o.stationIds) &&
          (d.stationIds.length < o.stationIds.length || j < i),
      ),
  );
  const long = unique.filter((d) => d.stationIds.length > 1);
  return long.length >= 2 ? long : unique;
}

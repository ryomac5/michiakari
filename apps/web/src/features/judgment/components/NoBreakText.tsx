import { splitUnbreakableRuns } from "../no-break";

// 時刻と、数と単位の組を途中で改行しないよう、その範囲だけ折り返しを止めて描く
export function NoBreakText({ text }: { text: string }) {
  return (
    <>
      {splitUnbreakableRuns(text).map((run, i) =>
        run.keep ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 文の区切りは順番だけで決まる
          <span key={i} className="whitespace-nowrap">
            {run.text}
          </span>
        ) : (
          run.text
        ),
      )}
    </>
  );
}

"""原因の区分ごとに所要時間の件数、中央値、80 パーセンタイルを表で出す。
パーセンタイルは線形補間。使い方: python3 summarize_durations.py"""
import json
from collections import defaultdict
from pathlib import Path

CASES = Path(__file__).parent / "cases.jsonl"


def percentile(sorted_values, p):
    pos = (len(sorted_values) - 1) * p
    low = int(pos)
    high = min(low + 1, len(sorted_values) - 1)
    return sorted_values[low] + (sorted_values[high] - sorted_values[low]) * (pos - low)


def group_durations(cases):
    groups = defaultdict(list)
    for case in cases:
        groups[case["cause_category"]].append(case["duration_minutes"])
    return groups


def render_table(groups):
    lines = ["| 原因の区分 | 件数 | 中央値 (分) | 80 パーセンタイル (分) |", "| --- | --- | --- | --- |"]
    for category, values in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        values.sort()
        lines.append(f"| {category} | {len(values)} | {percentile(values, 0.5):.0f} | {percentile(values, 0.8):.0f} |")
    every = sorted(v for vs in groups.values() for v in vs)
    lines.append(f"| 全体 | {len(every)} | {percentile(every, 0.5):.0f} | {percentile(every, 0.8):.0f} |")
    return "\n".join(lines)


def main():
    cases = [json.loads(line) for line in CASES.open(encoding="utf-8")]
    print(render_table(group_durations(cases)))


if __name__ == "__main__":
    main()

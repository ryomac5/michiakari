"""事例の所要時間とダミーの知見の p50・p80 を事象ごとに比べて表で出す。
知見側は、見合わせの開始から再開までに当たる段階の合計を使う。
使い方: python3 compare_with_dev_knowledge.py"""
import json
import re
from pathlib import Path

from summarize_durations import group_durations, percentile

HERE = Path(__file__).parent
KNOWLEDGE = HERE.parents[2] / "packages/schema/test/fixtures/dev-content/knowledge"

# 知見の事象、事例の区分、合計に含める段階。含める段階は見合わせの開始以後に限る
MAPPING = [
    ("person_accident", "person_accident", None),
    ("heavy_rain", "natural_rain", {"suspended", "rain_easing", "track_inspection"}),
    ("vehicle_failure", "vehicle_failure", None),
    ("vehicle_failure_short", "vehicle_failure", {"initial", "onsite_repair", "resuming"}),
    ("in_car_response", None, None),
]


PHASE_PATTERN = re.compile(
    r"^  - id: (\w+)$.*?duration_minutes: \{ p50: (\d+), p80: (\d+) \}", re.S | re.M
)


def read_phases(event_id):
    """段階の id と p50、p80 を YAML の書式に沿って読む。段階は phases 節だけを対象にする"""
    text = (KNOWLEDGE / f"{event_id}.yaml").read_text(encoding="utf-8")
    body = text.split("\nphases:\n", 1)[1].split("\nafter_resume:", 1)[0]
    chunks = re.split(r"(?m)^(?=  - id: )", body)
    return [(m[1], int(m[2]), int(m[3])) for c in chunks if (m := PHASE_PATTERN.search(c))]


def sum_phases(event_id, phase_ids):
    chosen = [p for p in read_phases(event_id.removesuffix("_short")) if phase_ids is None or p[0] in phase_ids]
    return sum(p[1] for p in chosen), sum(p[2] for p in chosen)


def main():
    cases = [json.loads(line) for line in (HERE / "cases.jsonl").open(encoding="utf-8")]
    groups = group_durations(cases)
    print("| 知見 | 事例の区分 | 件数 | 事例の中央値 | 事例の p80 | 知見の p50 | 知見の p80 | 中央値の差 | p80 の差 |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for event_id, category, phase_ids in MAPPING:
        k50, k80 = sum_phases(event_id, phase_ids)
        if category is None:
            print(f"| {event_id} | なし | 0 | - | - | {k50} | {k80} | - | - |")
            continue
        values = sorted(groups[category])
        c50, c80 = percentile(values, 0.5), percentile(values, 0.8)
        print(f"| {event_id} | {category} | {len(values)} | {c50:.0f} | {c80:.0f} | {k50} | {k80} | {k50 - c50:+.0f} | {k80 - c80:+.0f} |")


if __name__ == "__main__":
    main()

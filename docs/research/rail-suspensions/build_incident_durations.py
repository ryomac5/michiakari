"""python3 -I build_incident_durations.py で packages/core/params/incident-durations.ts を生成する。

標準ライブラリだけで動く。分位は summarize_durations.py（Polars の linear 補間）と同じ式で求める。
"""

import json
import math
from collections import Counter
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUTPUT = HERE.parents[2] / "packages" / "core" / "params" / "incident-durations.ts"
CREATED_ON = "2026-11-06"
CASE_FILES = [
    "cases.jsonl",
    "supplemental_jrw_2026-11-06.jsonl",
    "supplemental_private_2026-11-06.jsonl",
]
# 分類済みの記録を持たない cases.jsonl は、case_classifications.jsonl の主分類を使う
CLASSIFICATIONS = "case_classifications.jsonl"
MIN_TYPE_COUNT = 5
MIN_GROUP_COUNT = 3
UNKNOWN_SCOPE = "unknown"
MIN_PERIOD_COUNT = 5
# 通勤時間帯は平日の 7〜9 時台と 17〜19 時台。開発者が確かめた値
COMMUTE_HOURS = (range(7, 10), range(17, 20))
PERIODS = ("commute", "other")


def read_jsonl(name: str) -> list[dict]:
    lines = (HERE / name).read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def load_cases(taxonomy: dict) -> tuple[list[dict], int]:
    group_of = {t["id"]: t["group_id"] for t in taxonomy["types"]}
    primary = {r["case_id"]: r["primary_type"] for r in read_jsonl(CLASSIFICATIONS)}
    cases, seen, removed = [], set(), 0
    for name in CASE_FILES:
        for row in read_jsonl(name):
            type_id = row.get("type_id") or primary[row["id"]]
            group_id = row.get("group_id") or group_of[type_id]
            if group_of.get(type_id) != group_id:
                raise ValueError(f"大分類と種類が合わない: {row['id']}")
            key = (row["date"], row["line"], type_id)
            if key in seen:
                removed += 1
                continue
            seen.add(key)
            cases.append({
                "minutes": row["duration_minutes"],
                "group_id": group_id,
                "type_id": type_id,
                "stop_scope": row.get("stop_scope") or UNKNOWN_SCOPE,
                "period": classify_period(row.get("suspended_at")),
            })
    return cases, removed


def classify_period(suspended_at: dict | None) -> str | None:
    """止まった時刻の記録が無い事例は None とし、時間帯の集計に含めない"""
    if not suspended_at:
        return None
    stopped = datetime.fromisoformat(suspended_at["time"])
    is_weekday = stopped.weekday() < 5
    in_commute = any(stopped.hour in hours for hours in COMMUTE_HOURS)
    return "commute" if is_weekday and in_commute else "other"


def compute_quantile(sorted_values: list[int], q: float) -> float:
    position = (len(sorted_values) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * (position - lower)


def round_half_up(value: float) -> int:
    return math.floor(value + 0.5)


def summarize(cases: list[dict], min_count: int) -> dict:
    values = sorted(c["minutes"] for c in cases)
    scopes = Counter(c["stop_scope"] for c in cases)
    if not values:
        return {
            "count": 0, "min": None, "p50": None, "p80": None, "max": None,
            "scopes": {}, "reliability": None,
        }
    return {
        "count": len(values),
        "min": values[0],
        "p50": round_half_up(compute_quantile(values, 0.5)),
        "p80": round_half_up(compute_quantile(values, 0.8)),
        "max": values[-1],
        "scopes": dict(sorted(scopes.items())),
        "reliability": "sufficient" if len(values) >= min_count else None,
    }


def summarize_periods(cases: list[dict], whole: dict) -> dict:
    """区分の件数が足りなければ、まぜた値（全体の値）を p50 と p80 に入れる"""
    result = {}
    for period in PERIODS:
        own = summarize([c for c in cases if c["period"] == period], MIN_PERIOD_COUNT)
        use_mixed = own["reliability"] is None
        result[period] = {
            "count": own["count"],
            "own_p50": own["p50"],
            "own_p80": own["p80"],
            "p50": whole["p50"] if use_mixed else own["p50"],
            "p80": whole["p80"] if use_mixed else own["p80"],
            "reliability": "use_mixed" if use_mixed else "sufficient",
        }
    return result


def ts_number(value: int | None) -> str:
    return "null" if value is None else str(value)


def format_period(key: str, period: dict, indent: str) -> list[str]:
    inner = indent + "  "
    return [
        f"{indent}{key}: {{",
        f"{inner}count: {period['count']},",
        f"{inner}p50: {ts_number(period['p50'])},",
        f"{inner}p80: {ts_number(period['p80'])},",
        f"{inner}ownP50: {ts_number(period['own_p50'])},",
        f"{inner}ownP80: {ts_number(period['own_p80'])},",
        f'{inner}reliability: "{period["reliability"]}",',
        f"{indent}}},",
    ]


def format_entry(key: str, entry: dict, extra: list[str], indent: str) -> list[str]:
    inner = indent + "  "
    scope_lines = [f"{inner}  {k}: {v}," for k, v in entry["scopes"].items()]
    scope_block = (
        [f"{inner}stopScopeCounts: {{", *scope_lines, f"{inner}}},"]
        if scope_lines
        else [f"{inner}stopScopeCounts: {{}},"]
    )
    lines = [f"{indent}{key}: {{", *[f"{inner}{e}" for e in extra]]
    lines += [
        f"{inner}count: {entry['count']},",
        *[f"{inner}{k}: {ts_number(entry[k])}," for k in ("min", "p50", "p80", "max")],
        *scope_block,
        f'{inner}reliability: "{entry["reliability"]}",',
        f"{inner}byPeriod: {{",
        *[line for p in PERIODS for line in format_period(p, entry["periods"][p], inner + "  ")],
        f"{inner}}},",
        f"{indent}}},",
    ]
    return lines


def render(taxonomy: dict, cases: list[dict], removed: int) -> str:
    groups, types = taxonomy["groups"], taxonomy["types"]
    group_stats, type_stats = {}, {}
    for g in groups:
        s = summarize([c for c in cases if c["group_id"] == g["id"]], MIN_GROUP_COUNT)
        s["reliability"] = s["reliability"] or "insufficient"
        s["periods"] = summarize_periods([c for c in cases if c["group_id"] == g["id"]], s)
        group_stats[g["id"]] = s
    for t in types:
        s = summarize([c for c in cases if c["type_id"] == t["id"]], MIN_TYPE_COUNT)
        s["reliability"] = s["reliability"] or "use_group"
        s["periods"] = summarize_periods([c for c in cases if c["type_id"] == t["id"]], s)
        type_stats[t["id"]] = s

    out = [
        "// 運転見合わせから再開までの所要時間の統計値。このファイルは生成物で、手で書き換えない",
        f"// 生成元: docs/research/rail-suspensions/build_incident_durations.py（作成日 {CREATED_ON}）",
        f"// 元の事例: 公開の報道と鉄道会社の発表から集めた関西の事例 {len(cases)} 件（重複 {removed} 件を除外）",
        "// 報道に残る事例は長引いたものに偏るため、実際の所要時間より長めに出る",
        "// 分位は線形補間で求め、p50 と p80 は分に丸めた。時間の記録が無い事例は含まない",
        "",
        "// 件数が足りない種類は use_group とし、統計値を使わず大分類の値に頼る",
        "// 件数が足りない大分類は insufficient とする。事例が 1 件も無い種類は件数 0 で、統計値は null",
        f"export const MIN_TYPE_COUNT = {MIN_TYPE_COUNT};",
        f"export const MIN_GROUP_COUNT = {MIN_GROUP_COUNT};",
        "",
        "// 時間帯は止まった時刻で分ける。commute は平日の 7〜9 時台と 17〜19 時台、other はそれ以外。祝日は区別しない",
        "// 区分の件数が足りなければ use_mixed とし、p50 と p80 にまぜた値を入れる。区分だけの値は ownP50 と ownP80",
        f"export const MIN_PERIOD_COUNT = {MIN_PERIOD_COUNT};",
        'export const DURATION_PERIODS = ["commute", "other"] as const;',
        "export type DurationPeriod = (typeof DURATION_PERIODS)[number];",
        'export type PeriodReliability = "sufficient" | "use_mixed";',
        "",
        "export const INCIDENT_GROUP_IDS = [",
        *[f'  "{g["id"]}",' for g in groups],
        "] as const;",
        "export type IncidentGroupId = (typeof INCIDENT_GROUP_IDS)[number];",
        "",
        "export const INCIDENT_TYPE_IDS = [",
        *[f'  "{t["id"]}",' for t in types],
        "] as const;",
        "export type IncidentTypeId = (typeof INCIDENT_TYPE_IDS)[number];",
        "",
        "export type DurationReliability = \"sufficient\" | \"use_group\" | \"insufficient\";",
        "",
        "// 時間帯の区分ごとの値。止まった時刻の記録が無い事例は、どちらの区分にも数えない",
        "export type PeriodDurationStats = {",
        "  count: number;",
        "  p50: number | null;",
        "  p80: number | null;",
        "  ownP50: number | null;",
        "  ownP80: number | null;",
        "  reliability: PeriodReliability;",
        "};",
        "",
        "// 所要時間（分）。stopScopeCounts は見合わせの範囲ごとの件数。範囲の記録が無い事例は unknown",
        "export type IncidentDurationStats = {",
        "  count: number;",
        "  min: number | null;",
        "  p50: number | null;",
        "  p80: number | null;",
        "  max: number | null;",
        "  stopScopeCounts: Readonly<Record<string, number>>;",
        "  reliability: DurationReliability;",
        "  byPeriod: Readonly<Record<DurationPeriod, PeriodDurationStats>>;",
        "};",
        "",
        "export type IncidentTypeDurationStats = IncidentDurationStats & {",
        "  groupId: IncidentGroupId;",
        "};",
        "",
        "export type IncidentGroupDurations = Readonly<Record<IncidentGroupId, IncidentDurationStats>>;",
        "export type IncidentTypeDurations = Readonly<Record<IncidentTypeId, IncidentTypeDurationStats>>;",
        "",
        "export const INCIDENT_GROUP_DURATIONS: IncidentGroupDurations = {",
    ]
    for g in groups:
        out += format_entry(g["id"], group_stats[g["id"]], [], "  ")
    out += [
        "};",
        "",
        "export const INCIDENT_TYPE_DURATIONS: IncidentTypeDurations = {",
    ]
    for t in types:
        out += format_entry(t["id"], type_stats[t["id"]], [f'groupId: "{t["group_id"]}",'], "  ")
    out += ["};", ""]
    return "\n".join(out)


def main() -> None:
    taxonomy = json.loads((HERE / "taxonomy.json").read_text(encoding="utf-8"))
    cases, removed = load_cases(taxonomy)
    OUTPUT.write_text(render(taxonomy, cases, removed), encoding="utf-8")
    print(f"事例 {len(cases)} 件、重複除外 {removed} 件 -> {OUTPUT}")


if __name__ == "__main__":
    main()

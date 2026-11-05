"""cases.jsonl から cases.csv を作る。使い方: python3 build_csv.py"""
import csv
import json
from pathlib import Path

DIR = Path(__file__).parent
COLUMNS = [
    "id", "date", "operator", "line", "location", "cause_category", "cause_summary",
    "suspended_at", "suspended_approx", "resumed_at", "resumed_approx",
    "duration_minutes", "signals", "source_urls", "found_by", "notes",
]


def format_signal(signal):
    return f"{signal['at'] or '-'} {signal['signal']}"


def build_row(case):
    suspended = case["suspended_at"] or {}
    resumed = case["resumed_at"] or {}
    return {
        **case,
        "suspended_at": suspended.get("time"),
        "suspended_approx": suspended.get("approx"),
        "resumed_at": resumed.get("time"),
        "resumed_approx": resumed.get("approx"),
        "signals": " | ".join(format_signal(s) for s in case["signals"]),
        "source_urls": " | ".join(s["url"] for s in case["sources"]),
        "found_by": " | ".join(case["found_by"]),
    }


def main():
    cases = [json.loads(line) for line in (DIR / "cases.jsonl").open(encoding="utf-8")]
    with (DIR / "cases.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        for case in cases:
            writer.writerow({k: ("" if v is None else v) for k, v in build_row(case).items()})


if __name__ == "__main__":
    main()

"""uv run summarize_durations.py で、原因別の所要時間を集計する。"""

from research import read_cases, render_table, summarize_durations, validate_cases


def main() -> None:
    cases = read_cases()
    validate_cases(cases)
    print(render_table(
        summarize_durations(cases),
        ["原因", "件数", "中央値（分）", "p80（分）", "最短（分）", "最長（分）"],
    ))


if __name__ == "__main__":
    main()

"""uv run build_csv.py で、検査済みの事例CSVを再生成する。"""

from research import HERE, flatten_cases, read_cases, validate_cases


def main() -> None:
    cases = read_cases()
    validate_cases(cases)
    flatten_cases(cases).write_csv(HERE / "cases.csv", include_bom=True)


if __name__ == "__main__":
    main()

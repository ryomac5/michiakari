"""公開事例を検査し、CSV・集計・現行モデルとの比較を再生成する。"""

import json
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import polars as pl

HERE = Path(__file__).resolve().parent
MIN_DATE = "2024-01-01"
MAX_DATE = "2026-11-05"
SECONDS_PER_MINUTE = 60
DURATION_TOLERANCE_MINUTES = 0.01
MIN_GROUP_SIZE = 10
PRIMARY_PUBLISHERS = {"JR西日本", "Osaka Metro", "南海電気鉄道", "大阪モノレール", "叡山電鉄"}


def read_cases(path: Path = HERE / "cases.jsonl") -> pl.DataFrame:
    return pl.read_ndjson(path, infer_schema_length=None)


def validate_cases(cases: pl.DataFrame) -> None:
    seen = set()
    for case in cases.iter_rows(named=True):
        case_id = case["id"]
        if case_id in seen:
            raise ValueError(f"識別子が重複: {case_id}")
        seen.add(case_id)
        if not MIN_DATE <= case["date"] <= MAX_DATE:
            raise ValueError(f"対象期間外: {case_id}")
        duration = case["duration_minutes"]
        if duration is None or duration <= 0:
            raise ValueError(f"所要時間が不正: {case_id}")
        sources = case["sources"]
        if not sources:
            raise ValueError(f"出典なし: {case_id}")
        urls = {source["url"] for source in sources}
        for source in sources:
            parsed = urlparse(source["url"])
            if parsed.scheme != "https" or not parsed.netloc:
                raise ValueError(f"出典URLが不正: {case_id}")
            if not source["publisher"] or not source["accessed"] or not source["fields"]:
                raise ValueError(f"出典の記録が不足: {case_id}")
        for signal in case["signals"]:
            if signal["source_url"] not in urls:
                raise ValueError(f"兆候の出典が未登録: {case_id}")
        start, end = case["suspended_at"], case["resumed_at"]
        if not start or not end:
            if not case["notes"]:
                raise ValueError(f"時刻不足の理由なし: {case_id}")
            continue
        begin, finish = datetime.fromisoformat(start["time"]), datetime.fromisoformat(end["time"])
        if begin.utcoffset() is None or finish.utcoffset() is None:
            raise ValueError(f"時刻にタイムゾーンなし: {case_id}")
        elapsed = (finish - begin).total_seconds() / SECONDS_PER_MINUTE
        if abs(elapsed - duration) > DURATION_TOLERANCE_MINUTES:
            raise ValueError(f"時刻差と所要時間が不一致: {case_id}")
        if not start["time"].startswith(case["date"]):
            raise ValueError(f"開始日と発生日が不一致: {case_id}")


def flatten_cases(cases: pl.DataFrame) -> pl.DataFrame:
    return cases.select(
        "id", "date", "operator", "line", "location", "cause_category", "cause_summary",
        pl.col("suspended_at").struct.field("time").alias("suspended_at"),
        pl.col("suspended_at").struct.field("approx").cast(pl.String).replace({"true": "True", "false": "False"}).alias("suspended_approx"),
        pl.col("resumed_at").struct.field("time").alias("resumed_at"),
        pl.col("resumed_at").struct.field("approx").cast(pl.String).replace({"true": "True", "false": "False"}).alias("resumed_approx"),
        "duration_minutes",
        pl.col("signals").list.eval(
            pl.concat_str([
                pl.element().struct.field("at").fill_null("-"),
                pl.element().struct.field("signal"),
            ], separator=" ")
        ).list.join(" | "),
        pl.col("sources").list.eval(pl.element().struct.field("url")).list.join(" | ").alias("source_urls"),
        pl.col("found_by").list.join(" | "),
        "notes",
    ).with_columns(pl.col(pl.String).replace("", None))


def summarize_durations(cases: pl.DataFrame) -> pl.DataFrame:
    return (
        cases.lazy()
        .group_by("cause_category")
        .agg(
            pl.len().alias("count"),
            pl.col("duration_minutes").median().alias("median_minutes"),
            pl.col("duration_minutes").quantile(0.8, interpolation="linear").alias("p80_minutes"),
            pl.col("duration_minutes").min().alias("minimum_minutes"),
            pl.col("duration_minutes").max().alias("maximum_minutes"),
        )
        .sort("count", "cause_category", descending=[True, False])
        .collect()
    )


def evaluate_model(cases: pl.DataFrame, baselines: pl.DataFrame) -> pl.DataFrame:
    return (
        cases.lazy()
        .join(baselines.lazy(), on="cause_category", how="inner")
        .with_columns(
            (pl.col("predicted_p50") - pl.col("duration_minutes")).alias("error_minutes"),
            (pl.col("duration_minutes") <= pl.col("predicted_p80")).alias("within_p80"),
        )
        .select(
            "id", "date", "cause_category", "duration_minutes", "predicted_p50", "predicted_p80",
            "error_minutes", "within_p80", "knowledge_sha256", "basis",
        )
        .sort("id")
        .collect()
    )


def summarize_errors(evaluation: pl.DataFrame) -> pl.DataFrame:
    return (
        evaluation.lazy()
        .group_by("cause_category")
        .agg(
            pl.len().alias("count"),
            pl.col("predicted_p50").first(),
            pl.col("predicted_p80").first(),
            pl.col("error_minutes").abs().mean().alias("mean_absolute_error_minutes"),
            pl.col("error_minutes").mean().alias("mean_error_minutes"),
            pl.col("within_p80").sum().alias("within_p80_count"),
        )
        .sort("cause_category")
        .collect()
    )


def render_table(frame: pl.DataFrame, labels: list[str]) -> str:
    def format_value(value: object) -> str:
        return f"{value:.1f}" if isinstance(value, float) else str(value)

    lines = ["| " + " | ".join(labels) + " |", "| " + " | ".join("---" for _ in labels) + " |"]
    lines.extend("| " + " | ".join(format_value(value) for value in row) + " |" for row in frame.iter_rows())
    return "\n".join(lines)


def build_report(cases: pl.DataFrame, evaluation: pl.DataFrame, baselines: pl.DataFrame) -> str:
    summary = summarize_durations(cases)
    errors = summarize_errors(evaluation)
    exact = cases.filter(
        (pl.col("suspended_at").struct.field("approx") == False)
        & (pl.col("resumed_at").struct.field("approx") == False)
    ).height
    primary = sum(any(s["publisher"] in PRIMARY_PUBLISHERS for s in row["sources"]) for row in cases.iter_rows(named=True))
    small = ", ".join(summary.filter(pl.col("count") < MIN_GROUP_SIZE)["cause_category"].to_list())
    return f"""# 過去事例の点検と現行モデルの比較

対象は{MIN_DATE}〜{MAX_DATE}。計{cases.height}件を構造検査し、開始・再開の両方がある事例は時刻差と所要時間の一致も検査した。
両時刻が概数でない記録は{exact}件、事業者の公表資料を出典に含む記録は{primary}件。これは今回全件のリンクを再閲覧したという意味ではない。直近に追加したJR西日本3件と叡山電鉄4件は一次資料の時刻を個別に確認した。

## 所要時間の集計

{render_table(summary, ["原因", "件数", "中央値（分）", "p80（分）", "最短（分）", "最長（分）"])}

## 現在の開発用モデルとの比較

{render_table(errors, ["原因", "件数", "予測p50（分）", "予測p80（分）", "平均絶対誤差（分）", "平均誤差・予測−実績（分）", "p80以内の件数"])}

この比較は、事象を正しく識別でき、見合わせ開始時点で段階の経過が0分、途中の兆候と公式見込み時刻がない場合の固定予測である。coreの実際の分岐・下限・2万回の標本生成を使い、段階のp50/p80の単純加算はしない。大雨は運転見合わせ前の段階を除く。実績の終点に合わせ、再開後の初列車待ちは0にして比較した。

学習やパラメータの変更はしていないため、同じ事例を使った学習・評価の混同はない。ただし、報道に残った事例の選択バイアス、概数、発生時刻の代用、全区間と部分再開の違いがある。運用時の段階判定・途中時点の残り時間・実際に乗車できた時刻の精度は測れていない。p80以内の割合はこの標本での実績であり、利用者全体に対する保証ではない。

{MIN_GROUP_SIZE}件未満の区分（{small}）は特に少数で、実用の時間分布として採用できる根拠が不足する。事業者の事後報告も大きな障害に偏るため、件数だけで採用しない。

## 再現と出典

`uv sync --locked` の後、`uv run research.py` を実行する。cases.jsonlを正とし、cases.csv、duration_summary.csv、model_evaluation.csvとこの文書を生成する。出典URL・閲覧日・概数・注記はcases.jsonl/cases.csvに残る。対象外候補はscreened_candidates.jsonlに理由を記録する。

比較対象は開発用ダミー知見。再現用のファイル指紋はmodel_evaluation.csvに含む。情報源の利用条件はREADME.mdとdocs/data-sources.mdを参照する。収集や構造検査だけで学習利用の許諾が得られるわけではない。予測パラメータの自動更新はしない。

モデル指紋: {json.dumps(baselines.select("event", "knowledge_sha256").to_dicts(), ensure_ascii=False)}
"""


def main() -> None:
    cases = read_cases()
    validate_cases(cases)
    output = subprocess.run(["node", str(HERE / "model_baselines.mjs")], check=True, capture_output=True, text=True)
    baselines = pl.DataFrame(json.loads(output.stdout))
    evaluation = evaluate_model(cases, baselines)
    flatten_cases(cases).write_csv(HERE / "cases.csv", include_bom=True)
    summarize_durations(cases).write_csv(HERE / "duration_summary.csv")
    evaluation.write_csv(HERE / "model_evaluation.csv")
    (HERE / "validation_report.md").write_text(build_report(cases, evaluation, baselines), encoding="utf-8")
    print(f"事例{cases.height}件の検査、モデルとの比較{evaluation.height}件、CSVと報告書の生成が完了")


if __name__ == "__main__":
    main()

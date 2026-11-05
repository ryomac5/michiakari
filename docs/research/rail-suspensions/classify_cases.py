"""uv run classify_cases.py で、根拠付きの事象分類とバリエーションを再生成する。"""

import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import polars as pl

from research import (
    DURATION_TOLERANCE_MINUTES,
    HERE,
    SECONDS_PER_MINUTE,
    read_cases,
    render_table,
    validate_cases,
)

VALID_REGIONS = {"kansai", "outside_kansai"}


def read_taxonomy(path: Path = HERE / "taxonomy.json") -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_classifications(cases: pl.DataFrame, labels: pl.DataFrame, supplements: pl.DataFrame, taxonomy: dict) -> None:
    group_ids = [group["id"] for group in taxonomy["groups"]]
    type_ids = [item["id"] for item in taxonomy["types"]]
    if len(group_ids) != len(set(group_ids)) or len(type_ids) != len(set(type_ids)):
        raise ValueError("分類IDが重複")
    if any(item["group_id"] not in group_ids for item in taxonomy["types"]):
        raise ValueError("未定義の大分類")
    source_by_id = {
        row["id"]: {source["url"] for source in row["sources"]}
        for row in cases.iter_rows(named=True)
    }
    if labels["case_id"].n_unique() != labels.height:
        raise ValueError("事例の主分類が重複")
    if set(labels["case_id"]) != set(source_by_id):
        raise ValueError("未分類または存在しない事例")
    seen_types = set()
    for row in labels.iter_rows(named=True):
        if not row["evidence"] or not row["evidence_urls"]:
            raise ValueError("分類根拠なし")
        if not set(row["evidence_urls"]) <= source_by_id[row["case_id"]]:
            raise ValueError("元の事例にない出典")
    if supplements["id"].n_unique() != supplements.height or set(supplements["id"]) & set(source_by_id):
        raise ValueError("補助事例の重複")
    for row in supplements.iter_rows(named=True):
        if row["region"] not in VALID_REGIONS or row["use_for_duration_model"] is not False:
            raise ValueError("補助事例を時間モデルに混入できない")
        if not row["sources"] or not row["notes"]:
            raise ValueError("補助事例の出典・除外理由なし")
        for source in row["sources"]:
            parsed = urlparse(source["url"])
            if parsed.scheme != "https" or not parsed.netloc or not source["accessed"]:
                raise ValueError("補助事例の出典が不正")
        start, end, duration = row["suspended_at"], row["resumed_at"], row["duration_minutes"]
        if start and end:
            elapsed = (datetime.fromisoformat(end["time"]) - datetime.fromisoformat(start["time"])).total_seconds() / SECONDS_PER_MINUTE
            if duration is None or elapsed <= 0 or abs(elapsed - duration) > DURATION_TOLERANCE_MINUTES:
                raise ValueError("補助事例の時刻差が不一致")
    for frame in (labels, supplements):
        for row in frame.iter_rows(named=True):
            types = [row["primary_type"], *row["secondary_types"]]
            if len(types) != len(set(types)) or not set(types) <= set(type_ids):
                raise ValueError("副分類の重複または未定義の種類")
            if not row["variant"]:
                raise ValueError("変種の記録なし")
            seen_types.update(types)
    if seen_types != set(type_ids):
        raise ValueError("実例の根拠がない種類")


def combine_classifications(cases: pl.DataFrame, labels: pl.DataFrame, supplements: pl.DataFrame) -> pl.DataFrame:
    main = (
        cases.lazy()
        .join(labels.lazy(), left_on="id", right_on="case_id", how="inner")
        .select(
            "id", "date", "operator", "line", "location", "primary_type", "secondary_types", "variant",
            pl.lit("kansai").alias("region"),
            pl.lit("duration_case").alias("dataset"),
            pl.col("sources").list.eval(pl.element().struct.field("url")).list.join(" | ").alias("source_urls"),
        )
    )
    extra = supplements.lazy().select(
        "id", "date", "operator", "line", "location", "primary_type", "secondary_types", "variant", "region",
        pl.lit("classification_only").alias("dataset"),
        pl.col("sources").list.eval(pl.element().struct.field("url")).list.join(" | ").alias("source_urls"),
    )
    return pl.concat([main, extra]).sort("id").collect()


def summarize_coverage(classified: pl.DataFrame, taxonomy: dict) -> pl.DataFrame:
    support = (
        classified.lazy()
        .with_columns(pl.concat_list("primary_type", "secondary_types").alias("type_id"))
        .explode("type_id")
        .group_by("type_id")
        .agg(
            pl.len().alias("support_count"),
            (pl.col("dataset") == "duration_case").sum().alias("duration_case_count"),
            (pl.col("region") == "outside_kansai").sum().alias("outside_kansai_count"),
        )
    )
    groups = pl.DataFrame(taxonomy["groups"]).rename({"id": "group_id", "name": "group_name"})
    types = pl.DataFrame(taxonomy["types"]).rename({"id": "type_id", "name": "type_name"})
    return (
        types.lazy()
        .join(groups.lazy(), on="group_id")
        .join(support, on="type_id", how="left")
        .sort("group_id", "type_id")
        .collect()
    )


def render_report(classified: pl.DataFrame, coverage: pl.DataFrame, taxonomy: dict) -> str:
    columns = coverage.select("group_name", "type_name", "support_count", "duration_case_count", "outside_kansai_count")
    variants = classified.select("primary_type", "variant").unique().height
    main_count = classified.filter(pl.col("dataset") == "duration_case").height
    extra_count = classified.height - main_count
    lines = [
        "# 過去事例から作った事象分類とバリエーション",
        "",
        f"{len(taxonomy['groups'])}大分類・{coverage.height}種類。関西の時間付き事例{main_count}件と、分類用補助{extra_count}件の計{classified.height}件を整理した。主分類と変種の組は{variants}通り。件数を増やすために同じ事象を別事例に分割していない。",
        "",
        "主分類は1事例につき1つ。引き金と損傷の組合せは副分類で保持する。表の根拠件数は副分類も含むため合計して事例数とはしない。関西外・時刻不足・徐行のみ・単一列車・複合事象は分類用に限り、関西の時間分布に混ぜない。",
        "",
        render_table(columns, ["大分類", "種類", "根拠件数（副分類含む）", "関西の時間付き事例", "関西外の補助事例"]),
        "",
        "## 同じ原因でも分けるバリエーション",
        "",
        "| 観点 | 実例の違い | 時間予測で混ぜないこと |",
        "| --- | --- | --- |",
        "| 人の対応 | 人との接触、立ち入り、急病人の搬送、旅客トラブル | 非常ボタンの使用だけで原因や短時間の再開を確定しない |",
        "| 大雨 | 叡山電鉄2024-07-24は雨の弱まり後に再開、多摩2024-07-20は漏水で保安装置が故障 | 雨が止んだら設備も直るとは扱わない |",
        "| 落雷 | 叡山電鉄2024-07-24は信号の部品交換、多摩2024-07-21は軌道桁の補修 | 落雷を一律の待ち時間に置き換えない |",
        "| 雪・凍結 | 多摩2025-03-04は減速運転、叡山電鉄2025-02-08はポイントが動かず運休 | 最大遅延と見合わせ継続時間を混ぜない |",
        "| 動物との接触 | JR奈良方面2025-06-09は損傷の記録なし、叡山電鉄2024-06-18は空気漏れと救援列車 | 損傷の記録がないことを損傷なしと解釈しない |",
        "| 踏切 | 南海2024-02-06は列車と自動車が接触、叡山電鉄2025-02-01は自動車の撤去 | 立ち往生だけで列車との衝突や車両損傷を決めつけない |",
        "| 架線・電力 | 阪急2026-09-09はシートの支障、神戸電鉄2025-07-17は樹木の接触による停電 | 撤去・送電・設備復旧は別の観点として持つ |",
        "",
        "## アプリへの反映方針",
        "",
        "分類の種類と予測時間モデルの対応数は別である。この変更は調査資料の分類を拡充するもので、アプリの選択肢や推定時間を同じ種類数に増やしたものではない。既存モデルとの候補対応はtaxonomy.jsonのexisting_model_idに記録した。対応先があっても精度検証済みという意味ではない。",
        "",
        "追加する候補は、まず信号・ポイント、強風、停電、倒木・飛来物、動物接触、地震後の確認。次に急病人と旅客トラブルの分離、踏切の衝突と立ち往生の分離、大雨・落雷・雪に伴う設備損傷の分岐を検討する。分類だけで段階別の所要時間は作らない。",
        "",
        "後日判明した故障原因を含む事後分類であり、利用者が最初から細分類を答えられる前提にはしない。入口は放送で聞いた大分類を使い、詳細は追加情報があるときに絞る設計とする。急病人対応の補助事例には36分の全線停止もあり、急病というだけで数分と断定しない。",
        "",
        "## 出典と再現",
        "",
        f"元の{main_count}件はcases.jsonl、追加の{extra_count}件はsupplemental_cases.jsonlに出典URL・閲覧日・対象範囲・時刻不足の理由を持つ。case_classifications.jsonlは元事例への分類根拠と出典の対応を持ち、classified_cases.csvで事例ごとの分類を確認できる。報告書の表はtaxonomy_coverage.csvから再現する。",
        "",
        "`uv run classify_cases.py` で全事例の分類漏れ、出典との対応、主副分類、補助事例の混入禁止と日跨ぎの時刻差を検査して再生成する。本文・PDF・図表・個人の属性は転載しない。資料の利用条件はdocs/data-sources.mdを参照する。",
    ]
    # 実例へのリンクは、個別の資料と分類をたどれる形で残す。
    for item in taxonomy["types"]:
        examples = classified.filter(
            (pl.col("primary_type") == item["id"]) | pl.col("secondary_types").list.contains(item["id"])
        ).head(2)
        links = [f"[{row['id']}]({row['source_urls'].split(' | ')[0]})" for row in examples.iter_rows(named=True)]
        lines.extend(["", f"- {item['name']}: " + "、".join(links)])
    return "\n".join(lines) + "\n"


def main() -> None:
    cases = read_cases()
    validate_cases(cases)
    taxonomy = read_taxonomy()
    labels = pl.read_ndjson(HERE / "case_classifications.jsonl", infer_schema_length=None)
    supplements = pl.read_ndjson(HERE / "supplemental_cases.jsonl", infer_schema_length=None)
    validate_classifications(cases, labels, supplements, taxonomy)
    classified = combine_classifications(cases, labels, supplements)
    coverage = summarize_coverage(classified, taxonomy)
    classified.with_columns(pl.col("secondary_types").list.join(" | ")).write_csv(HERE / "classified_cases.csv", include_bom=True)
    coverage.write_csv(HERE / "taxonomy_coverage.csv")
    (HERE / "classification_report.md").write_text(render_report(classified, coverage, taxonomy), encoding="utf-8")
    print(f"{classified.height}事例、{coverage.height}種類、{len(taxonomy['groups'])}大分類の根拠と分類漏れを検査した")


if __name__ == "__main__":
    main()

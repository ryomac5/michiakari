"""種類を増やす際の根拠の欠落と集計対象の混入を検出する。"""

import copy
import unittest

import polars as pl

from classify_cases import (
    combine_classifications,
    read_taxonomy,
    summarize_coverage,
    validate_classifications,
)
from research import HERE, read_cases


class TestClassification(unittest.TestCase):
    def setUp(self) -> None:
        self.cases = read_cases()
        self.labels = pl.read_ndjson(HERE / "case_classifications.jsonl", infer_schema_length=None)
        self.supplements = pl.read_ndjson(HERE / "supplemental_cases.jsonl", infer_schema_length=None)
        self.taxonomy = read_taxonomy()

    def test_validate_every_collected_case(self) -> None:
        validate_classifications(self.cases, self.labels, self.supplements, self.taxonomy)
        combined = combine_classifications(self.cases, self.labels, self.supplements)
        self.assertEqual(combined.height, self.cases.height + self.supplements.height)
        coverage = summarize_coverage(combined, self.taxonomy)
        self.assertTrue((coverage["support_count"] > 0).all())

    def test_reject_missing_classification(self) -> None:
        with self.assertRaisesRegex(ValueError, "未分類"):
            validate_classifications(self.cases, self.labels.slice(1), self.supplements, self.taxonomy)

    def test_reject_duplicate_primary_classification(self) -> None:
        with self.assertRaisesRegex(ValueError, "主分類が重複"):
            validate_classifications(
                self.cases, pl.concat([self.labels, self.labels.head(1)]), self.supplements, self.taxonomy,
            )

    def test_reject_source_not_in_original_case(self) -> None:
        labels = self.labels.to_dicts()
        labels[0]["evidence_urls"] = ["https://unregistered.example/"]
        with self.assertRaisesRegex(ValueError, "元の事例にない出典"):
            validate_classifications(self.cases, pl.DataFrame(labels), self.supplements, self.taxonomy)

    def test_reject_unknown_secondary_type(self) -> None:
        labels = self.labels.to_dicts()
        labels[0]["secondary_types"] = ["invented_type"]
        with self.assertRaisesRegex(ValueError, "未定義の種類"):
            validate_classifications(self.cases, pl.DataFrame(labels), self.supplements, self.taxonomy)

    def test_reject_supplement_in_duration_model(self) -> None:
        supplements = self.supplements.to_dicts()
        supplements[0]["use_for_duration_model"] = True
        with self.assertRaisesRegex(ValueError, "時間モデルに混入"):
            validate_classifications(self.cases, self.labels, pl.DataFrame(supplements), self.taxonomy)

    def test_reject_double_counted_supplement(self) -> None:
        supplements = self.supplements.to_dicts()
        supplements[0]["id"] = self.cases["id"][0]
        with self.assertRaisesRegex(ValueError, "補助事例の重複"):
            validate_classifications(self.cases, self.labels, pl.DataFrame(supplements), self.taxonomy)

    def test_reject_unfounded_type(self) -> None:
        taxonomy = copy.deepcopy(self.taxonomy)
        taxonomy["types"].append({
            "id": "unobserved_type", "group_id": taxonomy["groups"][0]["id"],
            "name": "根拠のない事象", "definition": "未確認", "existing_model_id": None,
        })
        with self.assertRaisesRegex(ValueError, "実例の根拠がない"):
            validate_classifications(self.cases, self.labels, self.supplements, taxonomy)

    def test_reject_treating_25_oclock_as_same_day(self) -> None:
        supplements = self.supplements.to_dicts()
        case = next(row for row in supplements if row["id"] == "EIZ-2025-0201-crossing-obstruction")
        case["resumed_at"]["time"] = "2025-02-01T01:34+09:00"
        with self.assertRaisesRegex(ValueError, "時刻差が不一致"):
            validate_classifications(self.cases, self.labels, pl.DataFrame(supplements), self.taxonomy)


if __name__ == "__main__":
    unittest.main()

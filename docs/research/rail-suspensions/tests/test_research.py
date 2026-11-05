"""時刻の取り違えや結末の混入を検出する。"""

import copy
import unittest

import polars as pl

from research import evaluate_model, read_cases, summarize_durations, summarize_errors, validate_cases


class TestResearch(unittest.TestCase):
    def setUp(self) -> None:
        self.case = read_cases().row(0, named=True)

    def test_validate_collected_cases(self) -> None:
        validate_cases(read_cases())

    def test_reject_duplicate_id(self) -> None:
        with self.assertRaisesRegex(ValueError, "重複"):
            validate_cases(pl.DataFrame([self.case, self.case]))

    def test_reject_train_delay_as_suspension_duration(self) -> None:
        self.case["duration_minutes"] += 5
        with self.assertRaisesRegex(ValueError, "不一致"):
            validate_cases(pl.DataFrame([self.case]))

    def test_reject_unregistered_signal_source(self) -> None:
        self.case["signals"][0]["source_url"] = "https://unregistered.example/"
        with self.assertRaisesRegex(ValueError, "未登録"):
            validate_cases(pl.DataFrame([self.case]))

    def test_accept_resume_after_midnight(self) -> None:
        self.case["suspended_at"]["time"] = "2024-01-18T23:30+09:00"
        self.case["resumed_at"]["time"] = "2024-01-19T01:00+09:00"
        self.case["duration_minutes"] = 90
        validate_cases(pl.DataFrame([self.case]))

    def test_accept_reported_duration_without_exact_times(self) -> None:
        self.case["suspended_at"] = None
        self.case["resumed_at"] = None
        self.case["notes"] = "公表資料の所要時間のみを使用。"
        validate_cases(pl.DataFrame([self.case], schema=read_cases().schema))

    def test_do_not_use_observed_duration_to_change_prediction(self) -> None:
        second = copy.deepcopy(self.case)
        second["id"] = "different-outcome"
        second["duration_minutes"] = 200
        baselines = pl.DataFrame([{
            "cause_category": self.case["cause_category"],
            "predicted_p50": 60, "predicted_p80": 100,
            "knowledge_sha256": "fixture-hash", "basis": "onset",
        }])
        result = evaluate_model(pl.DataFrame([self.case, second]), baselines)
        self.assertEqual(result["predicted_p50"].to_list(), [60, 60])
        self.assertEqual(result["within_p80"].sum(), 1)
        errors = summarize_errors(result).row(0, named=True)
        self.assertEqual(errors["mean_absolute_error_minutes"], 83.0)

    def test_use_linear_quantiles(self) -> None:
        result = summarize_durations(pl.DataFrame({
            "cause_category": ["example"] * 3,
            "duration_minutes": [10, 20, 40],
        })).row(0, named=True)
        self.assertEqual(result["median_minutes"], 20)
        self.assertEqual(result["p80_minutes"], 32)


if __name__ == "__main__":
    unittest.main()

import unittest

from autodata.curation.content_gates import (
    fraction_shortcut_reason,
    has_unverified_iconqa_clock_reasoning,
    sanitize_relation_map_for_generated_task,
)


class ContentGateTest(unittest.TestCase):
    def test_fraction_gate_rejects_partition_count_retrieval(self):
        candidate = {
            "prompt_pool_id": "iconqa.diagram.fraction.v1",
            "question": (
                "Which image has the greatest number of equal parts?\n"
                "A. Image 1\nB. Image 2\nC. Image 3"
            ),
            "options": ["Image 1", "Image 2", "Image 3"],
        }
        self.assertIn("forbidden shortcut", fraction_shortcut_reason(candidate))

    def test_fraction_gate_accepts_cross_image_ratio_comparison(self):
        candidate = {
            "prompt_pool_id": "iconqa.diagram.fraction.v1",
            "question": (
                "Compare Image 1 and Image 2. Which has the greater fraction of the "
                "whole shaded?"
            ),
            "options": ["Image 1", "Image 2", "Same fraction"],
        }
        self.assertIsNone(fraction_shortcut_reason(candidate))

    def test_fraction_gate_ignores_other_routes(self):
        self.assertIsNone(fraction_shortcut_reason({
            "prompt_pool_id": "iconqa.diagram.geometry.v1",
            "question": "Which image has the most parts?",
        }))

    def test_rejects_iconqa_clock_question_without_enumerated_values(self):
        self.assertTrue(
            has_unverified_iconqa_clock_reasoning(
                "Which clock is exactly one hour after Image 2?",
                {"source": "IconQA", "source_answer_index": 2},
            )
        )

    def test_allows_clock_question_with_enumerated_values(self):
        self.assertFalse(
            has_unverified_iconqa_clock_reasoning(
                "Which clock is exactly one hour after Image 2?",
                {"source": "IconQA", "numeric_values": {"1": 7, "2": 6}},
            )
        )

    def test_does_not_apply_iconqa_rule_to_other_sources(self):
        self.assertFalse(
            has_unverified_iconqa_clock_reasoning(
                "Compare the hour hands.",
                {"source": "MuirBench"},
            )
        )

    def test_detects_chinese_clock_terms(self):
        self.assertTrue(
            has_unverified_iconqa_clock_reasoning(
                "哪个时钟比图2晚一个小时？",
                {"source": "IconQA"},
            )
        )

    def test_detects_source_what_time_wording(self):
        self.assertTrue(
            has_unverified_iconqa_clock_reasoning(
                "They rode for one hour. What time did they arrive?",
                {"source": "IconQA"},
            )
        )

    def test_sanitizes_hidden_original_task_labels(self):
        original = {
            "source": "IconQA",
            "source_question": "What time did they arrive?",
            "source_answer_index": 2,
            "relations": [{
                "evidence": [
                    "Images 1-4 are visual candidates.",
                    "For the source task, Image 3 is the annotated correct candidate.",
                ]
            }],
        }
        cleaned = sanitize_relation_map_for_generated_task(original)
        self.assertNotIn("source_question", cleaned)
        self.assertNotIn("source_answer_index", cleaned)
        self.assertEqual(
            cleaned["relations"][0]["evidence"],
            ["Images 1-4 are visual candidates."],
        )
        self.assertIn("source_answer_index", original)


if __name__ == "__main__":
    unittest.main()

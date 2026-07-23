import unittest

from autodata.curation.content_gates import (
    fraction_shortcut_reason,
    has_unverified_iconqa_clock_reasoning,
    partition_shortcut_reason,
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
        self.assertIn("partition count", fraction_shortcut_reason(candidate))

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

    def test_fraction_gate_accepts_plural_fraction_ordering(self):
        candidate = {
            "prompt_pool_id": "iconqa.diagram.fraction.v1",
            "question": (
                "Which ordering of the shaded fractions in Image 1, Image 2, and "
                "Image 3 is correct?\n\n"
                "A. Image 1 > Image 2 > Image 3\n"
                "B. Image 2 > Image 3 > Image 1\n"
                "C. Image 3 > Image 1 > Image 2\n"
                "D. Cannot be determined"
            ),
            "options": [
                "A. Image 1 > Image 2 > Image 3",
                "B. Image 2 > Image 3 > Image 1",
                "C. Image 3 > Image 1 > Image 2",
                "D. Cannot be determined",
            ],
        }
        self.assertIsNone(fraction_shortcut_reason(candidate))

    def test_fraction_gate_rejects_partition_superlative_even_with_ratio(self):
        candidate = {
            "prompt_pool_id": "iconqa.diagram.fraction.v1",
            "question": (
                "Which image has the greatest number of equal parts, and which shows "
                "the fraction 1/2 shaded? Compare Image 1, Image 2, and Image 3.\n"
                "A. Image 1 and Image 2\nB. Image 2 and Image 3"
            ),
            "options": ["Image 1 and Image 2", "Image 2 and Image 3"],
        }
        self.assertIn("partition count", fraction_shortcut_reason(candidate))

    def test_fraction_gate_ignores_other_routes(self):
        self.assertIsNone(fraction_shortcut_reason({
            "prompt_pool_id": "iconqa.diagram.geometry.v1",
            "question": "Which image has the most parts?",
        }))

    def test_partition_gate_rejects_direct_image_retrieval(self):
        candidate = {
            "prompt_pool_id": "iconqa.diagram.partition.v1",
            "question": (
                "Which image shows exactly two regions of equal area? "
                "Compare Image 1, Image 2, and Image 3."
            ),
        }
        self.assertIn("direct single-image", partition_shortcut_reason(candidate))

    def test_partition_gate_accepts_cross_image_statement(self):
        candidate = {
            "prompt_pool_id": "iconqa.diagram.partition.v1",
            "question": (
                "Compare Image 1, Image 2, and Image 3. Which statement correctly "
                "identifies the pair whose regions match in area and shape?"
            ),
        }
        self.assertIsNone(partition_shortcut_reason(candidate))

    def test_partition_gate_accepts_pair_stem_with_cross_image_options(self):
        candidate = {
            "prompt_pool_id": "iconqa.diagram.partition.v1",
            "question": "Which pair of images shows the same partition property?",
            "options": [
                "Image 1 and Image 2",
                "Image 1 and Image 3",
                "Image 2 and Image 3",
                "Cannot be determined from the given images",
            ],
        }
        self.assertIsNone(partition_shortcut_reason(candidate))

    def test_partition_gate_accepts_generic_statement_stem_with_pair_claims(self):
        candidate = {
            "prompt_pool_id": "iconqa.diagram.partition.v1",
            "question": "以下哪项跨图比较陈述是正确的？",
            "options": [
                "图2和图3都被一条垂直线分割，且左右两部分面积相等",
                "图1和图3都被分成两个区域，且分割线都是水平的",
                "图1和图2都被分成四个形状相同的区域",
                "无法根据给定图片确定",
            ],
        }
        self.assertIsNone(partition_shortcut_reason(candidate))

    def test_partition_gate_rejects_pair_stem_without_real_pair_options(self):
        candidate = {
            "prompt_pool_id": "iconqa.diagram.partition.v1",
            "question": "Which pair of images shows the same partition property?",
            "options": ["Image 1", "Image 2", "Image 3"],
        }
        self.assertIn(
            "does not explicitly depend",
            partition_shortcut_reason(candidate),
        )

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

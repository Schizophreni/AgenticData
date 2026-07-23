import unittest

from autodata.curation.content_gates import has_unverified_iconqa_clock_reasoning


class ContentGateTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()

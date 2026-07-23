import unittest
from unittest.mock import AsyncMock, patch

from autodata.curation.loop import (
    _score_mcq_or_judge,
    _semantic_repeat_feedback,
    _stem_similarity,
)


class McqScoringTest(unittest.IsolatedAsyncioTestCase):
    def test_semantic_repeat_similarity_ignores_option_shuffle(self):
        first = (
            "Which image shows a shape divided into exactly two equal parts?\n\n"
            "A. Image 1\nB. Image 2\nC. Image 3\nD. Cannot be determined"
        )
        shuffled = (
            "Which image shows a shape divided into exactly two equal parts?\n\n"
            "A. Image 3\nB. Image 1\nC. Image 2\nD. Cannot be determined"
        )
        self.assertEqual(_stem_similarity(first, shuffled), 1.0)

    def test_materially_different_stems_do_not_trip_repeat_gate(self):
        equality = "Which image shows a shape divided into exactly two equal parts?"
        containment = "Which pair of containers has handles but differs in lid shape?"
        self.assertLess(_stem_similarity(equality, containment), 0.82)

    def test_partition_repeat_feedback_forces_structure_and_predicate_change(self):
        feedback = _semantic_repeat_feedback(
            {"prompt_pool_id": "iconqa.diagram.partition.v1"},
            "Which pair has two equal regions?",
            0.95,
        )
        self.assertIn("switch question structure", feedback)
        self.assertIn("cross-image comparison statement", feedback)
        self.assertIn("change the visible predicate", feedback)

    def test_generic_repeat_feedback_does_not_inject_partition_rules(self):
        feedback = _semantic_repeat_feedback(
            {"prompt_pool_id": "iconqa.diagram.object_shape.v1"},
            "Which pair has the same silhouette?",
            0.9,
        )
        self.assertNotIn("partition task", feedback)

    async def test_parseable_three_four_and_five_option_answers_skip_vlm_judge(self):
        judge = object()
        cases = (
            (["one", "two", "none"], "A"),
            (["one", "two", "three", "none"], "B"),
            (["one", "two", "three", "four", "none"], "C"),
        )
        with (
            patch("autodata.curation.loop._emit"),
            patch("autodata.curation.loop.run_judge", new_callable=AsyncMock) as run_judge,
        ):
            for options, correct in cases:
                scores, details = await _score_mcq_or_judge(
                    judge,
                    {
                        "question": "Choose.",
                        "options": options,
                        "correct_answer": correct,
                        "rubric": [],
                    },
                    [],
                    "weak",
                    [{"answer": f"Final answer: {correct}"}],
                    "run",
                    "example",
                )
                self.assertEqual(scores, [1.0])
                self.assertEqual(details[0]["scorer"], "exact_match")

            run_judge.assert_not_awaited()

    async def test_unparseable_answer_falls_back_to_vlm_judge(self):
        with (
            patch("autodata.curation.loop._emit"),
            patch(
                "autodata.curation.loop.run_judge",
                new_callable=AsyncMock,
                return_value={"overall": 0.5},
            ) as run_judge,
        ):
            scores, details = await _score_mcq_or_judge(
                object(),
                {
                    "question": "Choose.",
                    "options": ["one", "two", "none"],
                    "correct_answer": "A",
                    "rubric": [],
                },
                [],
                "weak",
                [{"answer": "I cannot decide."}],
                "run",
                "example",
            )

        self.assertEqual(scores, [0.5])
        self.assertEqual(details[0]["scorer"], "judge_fallback")
        run_judge.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()

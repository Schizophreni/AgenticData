import unittest
from unittest.mock import AsyncMock, patch

from autodata.curation.loop import _score_mcq_or_judge


class McqScoringTest(unittest.IsolatedAsyncioTestCase):
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

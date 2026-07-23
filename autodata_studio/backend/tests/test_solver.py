import unittest

from autodata.agents.solver import run_solver
from autodata.providers.base import Completion


class RecordingClient:
    def __init__(self):
        self.messages = None

    async def chat(self, messages, temperature=None, max_tokens=None):
        self.messages = messages
        return Completion(text="B", completion_tokens=1)


class SolverPromptTest(unittest.IsolatedAsyncioTestCase):
    async def test_mcq_output_contract_is_repeated_after_question(self):
        client = RecordingClient()
        result = await run_solver(
            client,
            "Which pair is correct?\nA. 1+2\nB. 1+3\nC. 2+3",
            ["image"],
            is_mcq=True,
        )

        self.assertEqual(result["answer"], "B")
        self.assertIn("exactly one uppercase option letter", client.messages[-1].content)
        self.assertTrue(client.messages[-1].content.endswith("A, B, C, D, or E."))
        self.assertIn("entire response", client.messages[0].content)

    async def test_open_answer_does_not_receive_mcq_contract(self):
        client = RecordingClient()
        await run_solver(client, "Describe the scene.", ["image"], is_mcq=False)
        self.assertNotIn("uppercase option letter", client.messages[-1].content)


if __name__ == "__main__":
    unittest.main()

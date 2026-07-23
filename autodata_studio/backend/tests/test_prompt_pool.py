import unittest

from autodata.muirbench_taxonomy import TASK_TYPES
from autodata.prompt_pool import (
    TASK_PROMPTS,
    classify_iconqa_family,
    prompt_pool_catalog,
    select_prompt,
)


class PromptPoolTest(unittest.TestCase):
    def test_every_muir_task_has_a_prompt(self):
        self.assertEqual(set(TASK_PROMPTS), set(TASK_TYPES))
        self.assertEqual(len({spec.id for spec in TASK_PROMPTS.values()}), len(TASK_TYPES))

    def test_routes_iconqa_fraction_without_exposing_source_text(self):
        spec = select_prompt(
            {"source": "IconQA", "allowed_tasks": ["Diagram Understanding"]},
            {"question": "What fraction of the circle is shaded?"},
        )
        self.assertEqual(spec.id, "iconqa.diagram.fraction.v1")
        self.assertIn("Every substantive option", spec.instruction)
        self.assertIn("cross-image ratio comparison", spec.instruction)
        self.assertNotIn("circle is shaded", spec.instruction)

    def test_iconqa_family_classifier(self):
        cases = {
            "How many triangles are shown?": "counting",
            "Which rectangle is symmetric?": "geometry",
            "Which object is shaped like a cylinder?": "object_shape",
            "Which object is above the square?": "spatial",
            "What comes next in the pattern?": "pattern",
            "Which line is longer?": "measurement",
            "Select the picture that shows equal parts.": "partition",
            "Choose the matching diagram.": "generic",
        }
        for question, expected in cases.items():
            with self.subTest(question=question):
                self.assertEqual(
                    classify_iconqa_family({"question": question}), expected
                )

    def test_routes_non_iconqa_by_allowed_task(self):
        spec = select_prompt(
            {"source": "Zhihu", "allowed_tasks": ["Difference Spotting"]},
        )
        self.assertEqual(spec.id, "muir.difference_spotting.v1")

    def test_generic_diagram_prompt_blocks_invented_near_duplicate_differences(self):
        spec = select_prompt(
            {"source": "IconQA", "allowed_tasks": ["Diagram Understanding"]},
            {"question": "Choose the matching diagram."},
        )
        self.assertEqual(spec.id, "muir.diagram.generic.v1")
        self.assertIn("identical or near-identical", spec.instruction)
        self.assertIn("crop jitter", spec.instruction)
        self.assertIn("never invent", spec.instruction)
        self.assertIn("per-image truth table", spec.instruction)
        self.assertIn("exactly one substantive candidate", spec.instruction)

    def test_spatial_prompt_keeps_decisive_evidence_spatial(self):
        spec = select_prompt(
            {"source": "IconQA", "allowed_tasks": ["Diagram Understanding"]},
            {"question": "Which object is above the square?"},
        )
        self.assertEqual(spec.id, "iconqa.diagram.spatial.v1")
        self.assertIn("decisive evidence must be spatial", spec.instruction)
        self.assertIn("do not substitute color", spec.instruction)
        self.assertIn("exactly one candidate", spec.instruction)

    def test_catalog_ids_are_unique(self):
        catalog = prompt_pool_catalog()
        self.assertEqual(len({item["id"] for item in catalog}), len(catalog))


if __name__ == "__main__":
    unittest.main()

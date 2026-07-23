import unittest

from autodata.muirbench_taxonomy import allowed_tasks


class MuirBenchTaxonomyTest(unittest.TestCase):
    def test_diagram_relation_and_graphics(self):
        self.assertEqual(
            allowed_tasks(["Graphics", "Graphics"], ["Cropped/Zoomed"]),
            ["Diagram Understanding"],
        )

    def test_slides_ordered_pages(self):
        self.assertEqual(
            allowed_tasks(["Slides", "Slides"], ["Ordered_Pages"]),
            ["Image-Text Matching", "Difference Spotting", "Counting", "Ordering"],
        )

    def test_incompatible_pair_is_rejected(self):
        self.assertEqual(allowed_tasks(["Photography"], ["Object-Multiview"]), [])

    def test_unknown_image_type_is_rejected(self):
        self.assertEqual(allowed_tasks(["Chat Screenshot"], ["Complementary"]), [])


if __name__ == "__main__":
    unittest.main()

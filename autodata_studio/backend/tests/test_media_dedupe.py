import tempfile
import unittest
from pathlib import Path

from autodata.curation.media_dedupe import filter_unique_image_docs


class MediaDedupeTest(unittest.TestCase):
    def test_different_paths_with_same_bytes_are_deduplicated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            accepted = root / "accepted.png"
            duplicate = root / "duplicate.png"
            unique = root / "unique.png"
            accepted.write_bytes(b"same image bytes")
            duplicate.write_bytes(b"same image bytes")
            unique.write_bytes(b"different image bytes")

            kept, skipped = filter_unique_image_docs(
                [
                    {"id": "duplicate", "images": [str(duplicate)]},
                    {"id": "unique", "images": [str(unique)]},
                ],
                [accepted],
            )

        self.assertEqual([doc["id"] for doc in kept], ["unique"])
        self.assertEqual(skipped, 1)

    def test_images_are_reserved_across_docs_in_same_shard(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "first.png"
            second = root / "second.png"
            first.write_bytes(b"shared")
            second.write_bytes(b"shared")

            kept, skipped = filter_unique_image_docs(
                [
                    {"id": "first", "images": [str(first)]},
                    {"id": "second", "images": [str(second)]},
                ],
                [],
            )

        self.assertEqual([doc["id"] for doc in kept], ["first"])
        self.assertEqual(skipped, 1)

    def test_duplicate_images_within_one_doc_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "image.png"
            image.write_bytes(b"one image")
            kept, skipped = filter_unique_image_docs(
                [{"id": "bad", "images": [str(image), str(image)]}],
                [],
            )

        self.assertEqual(kept, [])
        self.assertEqual(skipped, 1)


if __name__ == "__main__":
    unittest.main()

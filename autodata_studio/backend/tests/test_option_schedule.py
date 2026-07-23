import unittest
from collections import Counter

from autodata.option_schedule import option_count_schedule


class OptionCountScheduleTest(unittest.TestCase):
    def test_full_shard_matches_target_mix(self):
        self.assertEqual(
            Counter(option_count_schedule(50, "full")),
            Counter({3: 6, 4: 24, 5: 20}),
        )

    def test_small_shards_keep_four_as_largest_bucket(self):
        self.assertEqual(
            Counter(option_count_schedule(12, "twelve")),
            Counter({3: 1, 4: 6, 5: 5}),
        )
        self.assertEqual(
            Counter(option_count_schedule(8, "eight")),
            Counter({3: 1, 4: 4, 5: 3}),
        )

    def test_schedule_is_deterministic_and_distributed(self):
        first = option_count_schedule(12, "cursor-16050")
        self.assertEqual(first, option_count_schedule(12, "cursor-16050"))
        self.assertNotEqual(first, option_count_schedule(12, "cursor-16100"))
        self.assertEqual(set(first), {3, 4, 5})


if __name__ == "__main__":
    unittest.main()

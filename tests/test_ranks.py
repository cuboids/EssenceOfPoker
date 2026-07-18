import unittest

from essence_of_poker.ranks import Rank, parse_rank, ranks_high_to_low, rank_to_symbol


class RankTests(unittest.TestCase):
    def test_rank_values(self) -> None:
        self.assertEqual(Rank.ACE, 1)
        self.assertEqual(Rank.KING, 2)
        self.assertEqual(Rank.QUEEN, 3)
        self.assertEqual(Rank.JACK, 4)
        self.assertEqual(Rank.TEN, 5)
        self.assertEqual(Rank.TWO, 13)

    def test_rank_symbols(self) -> None:
        self.assertEqual(rank_to_symbol(Rank.ACE), "A")
        self.assertEqual(rank_to_symbol(Rank.KING), "K")
        self.assertEqual(rank_to_symbol(Rank.TEN), "T")
        self.assertEqual(rank_to_symbol(Rank.TWO), "2")

    def test_parse_rank(self) -> None:
        self.assertEqual(parse_rank("A"), Rank.ACE)
        self.assertEqual(parse_rank("k"), Rank.KING)
        self.assertEqual(parse_rank("10"), Rank.TEN)
        self.assertEqual(parse_rank(" 2 "), Rank.TWO)

    def test_parse_rank_rejects_unknown_symbols(self) -> None:
        with self.assertRaises(ValueError):
            parse_rank("1")

    def test_ranks_high_to_low(self) -> None:
        self.assertEqual(
            ranks_high_to_low(),
            (
                Rank.ACE,
                Rank.KING,
                Rank.QUEEN,
                Rank.JACK,
                Rank.TEN,
                Rank.NINE,
                Rank.EIGHT,
                Rank.SEVEN,
                Rank.SIX,
                Rank.FIVE,
                Rank.FOUR,
                Rank.THREE,
                Rank.TWO,
            ),
        )


if __name__ == "__main__":
    unittest.main()


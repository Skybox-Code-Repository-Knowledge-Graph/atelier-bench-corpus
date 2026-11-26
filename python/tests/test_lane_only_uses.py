"""
Lane-only constructs that nothing else selects get their use here (issue #223, D.3).

`OrderVolumeService.by` builds a method name from its argument (task def-string-key-dispatch keys
both `scope_*` targets). Before this test only the `"open"` key was ever passed, so
`scope_completed` was a declaration no call could reach.
"""

import unittest

from atelier_app.state import seeded_state
from atelier_bench.services import OrderVolumeService


class LaneOnlyUseTest(unittest.TestCase):
    def test_every_scope_key_selects_its_method(self) -> None:
        data = seeded_state().data
        service = OrderVolumeService()
        self.assertEqual(service.by(data, "open"), 3)
        self.assertEqual(service.by(data, "completed"), 1)
        self.assertEqual(service.by(data, "open") + service.by(data, "completed"), len(data.orders))
        with self.assertRaises(AttributeError):
            service.by(data, "archived")


if __name__ == "__main__":
    unittest.main()

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import check_generated_data_ready


class GeneratedDataReadyTests(unittest.TestCase):
    def test_generated_data_checker_reports_missing_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            missing = Path(temp_dir) / "missing.json"
            with patch.object(check_generated_data_ready, "REQUIRED_FILES", (missing,)):
                errors = check_generated_data_ready.generated_data_errors()

        self.assertIn("missing generated artifact", errors[0])

    def test_generated_data_checker_accepts_current_artifacts(self) -> None:
        self.assertEqual(check_generated_data_ready.generated_data_errors(), [])


if __name__ == "__main__":
    unittest.main()

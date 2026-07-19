#!/usr/bin/env python3
"""Check that local/generated artifacts obey the repository artifact policy."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from essence_of_poker.artifact_policy import policy_summary, tracked_policy_violations


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="emit a machine-readable policy report")
    args = parser.parse_args()

    violations = tracked_policy_violations()
    if args.json:
        print(json.dumps({"ok": not violations, "policy": policy_summary(), "violations": violations}, indent=2))
    elif violations:
        print("Artifact policy violations:")
        for violation in violations:
            print(f"- {violation['path']} ({violation['disposition']}): {violation['reason']}")
    else:
        print("Artifact policy OK")

    if violations:
        sys.exit(1)


if __name__ == "__main__":
    main()

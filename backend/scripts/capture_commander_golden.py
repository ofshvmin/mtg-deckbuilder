"""Capture the Commander generator golden snapshot.

Run this ONCE, before the multi-copy refactor, to record what the generator produces
today. `tests/test_commander_golden.py` then asserts the refactored generator produces
exactly the same thing.

Re-running this after the refactor would overwrite the evidence and make the test
vacuous. If it fails, fix the generator — don't recapture.

    python scripts/capture_commander_golden.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tests.test_commander_golden import (  # noqa: E402
    GOLDEN_PATH,
    generate_commander_deck,
    snapshot,
)


def main() -> int:
    if GOLDEN_PATH.exists():
        print(f"refusing to overwrite existing golden file: {GOLDEN_PATH}")
        print("delete it deliberately if you really mean to recapture.")
        return 1

    GOLDEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    data = snapshot(generate_commander_deck())
    GOLDEN_PATH.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    print(f"captured {len(data['cards'])} cards -> {GOLDEN_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

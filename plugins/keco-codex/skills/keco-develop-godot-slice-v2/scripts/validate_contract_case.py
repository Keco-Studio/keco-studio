#!/usr/bin/env python3
"""Return the canonical accept/reject decision for one Slice V2 contract case."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from slice_contract import validate_contract_case


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("boundary")
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    try:
        value = json.loads(args.path.read_text(encoding="utf-8"))
        decision = validate_contract_case(args.boundary, value)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"contract case invalid: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(decision, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

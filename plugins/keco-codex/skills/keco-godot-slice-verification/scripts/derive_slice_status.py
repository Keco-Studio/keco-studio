#!/usr/bin/env python3
"""Derive Slice implementation, verification, acceptance, and release status."""
import argparse
import json
import pathlib
import sys

_HERE = pathlib.Path(__file__).resolve()
for _candidate in (
    _HERE.parents[2] / "keco-godot-slice-preflight" / "scripts",
    _HERE.parents[1] / "skills" / "keco-godot-slice-preflight" / "scripts",
):
    if (_candidate / "slice_contract.py").is_file():
        sys.path.insert(0, str(_candidate))
        break

from slice_contract import derive_slice_status


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    try:
        value = json.loads(args.input.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("status input must be an object")
        result = {"schemaVersion": 1, **derive_slice_status(value)}
        encoded = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(encoded, encoding="utf-8")
        else:
            print(encoded, end="")
        return 0
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"status input invalid: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

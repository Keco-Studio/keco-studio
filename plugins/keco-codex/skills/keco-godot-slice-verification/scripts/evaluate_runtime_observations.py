#!/usr/bin/env python3
"""Compute assertion results from locked EvalSpec and Godot debug output."""
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

from slice_contract import evaluate_observation, parse_observation


MAX_SPEC_BYTES = 1024 * 1024
MAX_DEBUG_BYTES = 4 * 1024 * 1024
MAX_EVIDENCE_LINE_BYTES = 64 * 1024
MAX_EVALUATIONS = 100


def _read_bounded(path: pathlib.Path, maximum: int, label: str) -> str:
    if path.stat().st_size > maximum:
        raise ValueError(f"{label} exceeds the {maximum}-byte limit")
    return path.read_text(encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--eval-spec", type=pathlib.Path, required=True)
    parser.add_argument("--debug-output", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    try:
        args.output.unlink(missing_ok=True)
        raw_spec = json.loads(_read_bounded(args.eval_spec, MAX_SPEC_BYTES, "EvalSpec"))
        if not isinstance(raw_spec, dict):
            raise ValueError("EvalSpec must be an object")
        contract_version = raw_spec.get("schemaVersion")
        if contract_version != 2:
            raise ValueError("Slice V2 EvalSpec must use schemaVersion 2")
        expected_keys = {"schemaVersion", "coverageMode", "evaluations"}
        expected_keys.add("sourceProfileHash" if raw_spec.get("coverageMode") == "non_gdd" else "inventoryHash")
        if raw_spec.get("coverageMode") == "gdd":
            expected_keys.add("requirementIds")
        if set(raw_spec) != expected_keys:
            raise ValueError("Slice V2 EvalSpec coverage fields are invalid")
        specs = raw_spec.get("evaluations")
        if not isinstance(specs, list) or not 0 < len(specs) <= MAX_EVALUATIONS:
            raise ValueError("EvalSpec requires a non-empty evaluations array")
        if any(not isinstance(item, dict) or not isinstance(item.get("servedByTasks"), list) or not item["servedByTasks"] for item in specs):
            raise ValueError("Slice V2 evaluations require servedByTasks")
        by_id = {
            item.get("evalId"): {key: value for key, value in item.items() if key != "servedByTasks"}
            for item in specs if isinstance(item, dict)
        }
        if len(by_id) != len(specs) or None in by_id:
            raise ValueError("EvalSpec evaluation IDs must be unique")
        observations = []
        for line in _read_bounded(args.debug_output, MAX_DEBUG_BYTES, "debug output").splitlines():
            if len(line.encode("utf-8")) > MAX_EVIDENCE_LINE_BYTES:
                raise ValueError("runtime evidence line exceeds the byte limit")
            if line.startswith("KECO_OBSERVATION "):
                observations.append(parse_observation(json.loads(line.removeprefix("KECO_OBSERVATION "))))
            if len(observations) > MAX_EVALUATIONS:
                raise ValueError("runtime evidence contains too many observations")
        ids = [item["evalId"] for item in observations]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate runtime observation")
        if set(ids) != set(by_id):
            raise ValueError("runtime observations must cover every EvalSpec evaluation exactly once")
        results = [evaluate_observation(by_id[item["evalId"]], item) for item in observations]
        output = {"schemaVersion": 2, "status": "passed" if all(item["status"] == "passed" for item in results) else "partial" if any(item["status"] in {"passed", "manual_required"} for item in results) else "failed", "evaluations": results}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps({"ok": True, "status": output["status"], "evaluationCount": len(results)}, sort_keys=True))
        return 0
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"runtime evidence invalid: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Append one evaluation event to progress.jsonl and progress.md."""

import argparse
import json
import pathlib
from datetime import datetime, timezone
from typing import Any


def append_event(
    run_dir: pathlib.Path,
    segment: str,
    goal: str,
    inputs: Any,
    execution: str,
    expected_output: str,
    actual_result: Any,
    meaning: str,
    next_impact: str,
) -> dict[str, Any]:
    run_dir.mkdir(parents=True, exist_ok=True)
    event = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "segment": segment,
        "goal": goal,
        "inputs": inputs,
        "execution": execution,
        "expectedOutput": expected_output,
        "actualResult": actual_result,
        "meaning": meaning,
        "nextImpact": next_impact,
        "steps": [{
            "tool": execution,
            "parameters": inputs,
            "output": actual_result,
            "meaning": meaning,
            "nextImpact": next_impact,
        }],
    }
    with (run_dir / "progress.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")
    with (run_dir / "progress.md").open("a", encoding="utf-8") as handle:
        handle.write(f"## {segment}\n\n")
        handle.write(f"- \u76ee\u6807: {goal}\n")
        handle.write("- \u8f93\u5165:\n\n```json\n")
        handle.write(json.dumps(inputs, ensure_ascii=False, indent=2, sort_keys=True) + "\n```\n\n")
        handle.write(f"- \u6267\u884c\u65b9\u5f0f: {execution}\n- \u9884\u671f\u8f93\u51fa: {expected_output}\n")
        handle.write("- \u5b9e\u9645\u7ed3\u679c:\n\n```json\n")
        handle.write(json.dumps(actual_result, ensure_ascii=False, indent=2, sort_keys=True) + "\n```\n\n")
        handle.write(f"- \u5177\u4f53\u542b\u4e49: {meaning}\n- \u5bf9\u4e0b\u4e00\u6b65\u5f71\u54cd: {next_impact}\n\n")
        handle.write("### \u6b65\u9aa4 1\n\n")
        handle.write(f"- \u5de5\u5177: {execution}\n- \u53c2\u6570:\n\n```json\n")
        handle.write(json.dumps(inputs, ensure_ascii=False, indent=2, sort_keys=True) + "\n```\n\n")
        handle.write("- \u8f93\u51fa:\n\n```json\n")
        handle.write(json.dumps(actual_result, ensure_ascii=False, indent=2, sort_keys=True) + "\n```\n\n")
        handle.write(f"- \u5177\u4f53\u542b\u4e49: {meaning}\n- \u5bf9\u4e0b\u4e00\u6b65\u5f71\u54cd: {next_impact}\n\n")
    return event


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=pathlib.Path, required=True)
    parser.add_argument("--segment", required=True)
    parser.add_argument("--goal", required=True)
    parser.add_argument("--inputs", type=pathlib.Path, required=True)
    parser.add_argument("--execution", required=True)
    parser.add_argument("--expected-output", required=True)
    parser.add_argument("--actual-result", required=True)
    parser.add_argument("--meaning", required=True)
    parser.add_argument("--next-impact", required=True)
    args = parser.parse_args()
    inputs = json.loads(args.inputs.read_text(encoding="utf-8"))
    actual = json.loads(args.actual_result)
    append_event(args.run_dir, args.segment, args.goal, inputs, args.execution,
                 args.expected_output, actual, args.meaning, args.next_impact)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

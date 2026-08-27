#!/usr/bin/env python3
"""Append one unique evaluation fact and regenerate its Markdown projection."""

import argparse
import json
import pathlib
from datetime import datetime, timezone
from typing import Any

from execution_cache import read_events


def render_markdown(run_dir: pathlib.Path) -> None:
    sections = []
    for event in read_events(run_dir):
        sections.append(
            f"## {event['segment']}\n\n"
            f"- Goal: {event['goal']}\n"
            f"- Operation key: `{event['operationKey']}`\n"
            f"- Input hash: `{event['inputHash']}`\n"
            f"- Output hash: `{event['outputHash']}`\n"
            f"- Outcome: `{event['outcome']}`\n"
            f"- Execution: {event['execution']}\n"
            f"- Expected output: {event['expectedOutput']}\n"
            f"- Inputs:\n\n```json\n{json.dumps(event['inputs'], ensure_ascii=False, indent=2, sort_keys=True)}\n```\n\n"
            f"- Actual result:\n\n```json\n{json.dumps(event['actualResult'], ensure_ascii=False, indent=2, sort_keys=True)}\n```\n\n"
            f"- Meaning: {event['meaning']}\n"
            f"- Next impact: {event['nextImpact']}\n"
        )
    (run_dir / "progress.md").write_text("\n".join(sections), encoding="utf-8")


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
    operation_key: str,
    input_hash: str,
    output_hash: str,
    outcome: str = "created",
) -> dict[str, Any]:
    run_dir.mkdir(parents=True, exist_ok=True)
    for existing in read_events(run_dir):
        if existing.get("operationKey") != operation_key:
            continue
        if existing.get("inputHash") != input_hash or existing.get("outputHash") != output_hash:
            raise ValueError("execution key is already bound to different input or output")
        render_markdown(run_dir)
        return existing
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
        "operationKey": operation_key,
        "inputHash": input_hash,
        "outputHash": output_hash,
        "outcome": outcome,
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
    render_markdown(run_dir)
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
    parser.add_argument("--operation-key", required=True)
    parser.add_argument("--input-hash", required=True)
    parser.add_argument("--output-hash", required=True)
    args = parser.parse_args()
    inputs = json.loads(args.inputs.read_text(encoding="utf-8"))
    actual = json.loads(args.actual_result)
    append_event(args.run_dir, args.segment, args.goal, inputs, args.execution,
                 args.expected_output, actual, args.meaning, args.next_impact,
                 args.operation_key, args.input_hash, args.output_hash)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

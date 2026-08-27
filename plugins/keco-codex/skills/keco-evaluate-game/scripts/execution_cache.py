#!/usr/bin/env python3
"""Deterministic execution keys and verified artifact reuse."""

import hashlib
import json
import pathlib
from typing import Any


CONTRACT_VERSION = "keco-game-evaluation-v1"


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def sha256_bytes(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


def sha256_json(value: Any) -> str:
    return sha256_bytes(canonical_json(value).encode("utf-8"))


def sha256_file(path: pathlib.Path) -> str:
    return sha256_bytes(path.read_bytes())


def execution_identity(operation: str, evaluator_version: str, inputs: Any) -> tuple[str, str]:
    input_hash = sha256_json(inputs)
    key = sha256_json({
        "operation": operation,
        "evaluatorVersion": evaluator_version,
        "contractVersion": CONTRACT_VERSION,
        "inputHash": input_hash,
    })
    return key, input_hash


def read_events(run_dir: pathlib.Path) -> list[dict[str, Any]]:
    path = run_dir / "progress.jsonl"
    if not path.exists():
        return []
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError("progress.jsonl contains a non-object event")
        events.append(value)
    return events


def reusable_event(
    run_dir: pathlib.Path,
    operation_key: str,
    input_hash: str,
    output: pathlib.Path,
) -> dict[str, Any] | None:
    matches = [event for event in read_events(run_dir) if event.get("operationKey") == operation_key]
    if not matches:
        return None
    event = matches[-1]
    if event.get("inputHash") != input_hash:
        raise ValueError("execution key is already bound to different input")
    if not output.exists() or event.get("outputHash") != sha256_file(output):
        return None
    return event

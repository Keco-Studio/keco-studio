#!/usr/bin/env python3
"""Validate a conservative deterministic Slice delivery policy."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


DEFAULT_CANDIDATES = (
    Path(__file__).parent.parent / "references" / "default-delivery-policy.json",
    Path(__file__).parent.parent / "skills" / "keco-godot-slice-delivery" / "references" / "default-delivery-policy.json",
    Path(__file__).parent.parent / "skills" / "keco-develop-godot-slice-v2" / "references" / "default-delivery-policy.json",
)
REQUIRED_ARTIFACTS = ("TaskResult", "TaskReview", "EvalReport", "MirrorVerification")
RELEASE_ORDER = (
    "implementation", "runtime_verification", "acceptance", "manual_review",
    "package", "roadmap_completion", "mirrors", "seal",
)


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def fail(message: str) -> None:
    raise ValueError(message)


def validate(policy: Any) -> dict[str, Any]:
    if not isinstance(policy, dict):
        fail("delivery policy must be a JSON object")
    expected_keys = {
        "schemaVersion", "requiredArtifacts", "runtimeEvidenceFreshness",
        "maximumRepairs", "releaseOrder", "manualReviewBlocksRelease",
    }
    if set(policy) != expected_keys:
        fail("delivery policy contains unsupported or missing keys")
    if policy["schemaVersion"] != 2:
        fail("delivery policy schemaVersion is not recognized")
    artifacts = policy["requiredArtifacts"]
    if artifacts != list(REQUIRED_ARTIFACTS):
        fail("requiredArtifacts must preserve the canonical order")
    if policy["runtimeEvidenceFreshness"] != "current_build_and_snapshot":
        fail("delivery policy weakens runtime evidence freshness")
    repairs = policy["maximumRepairs"]
    if not isinstance(repairs, int) or isinstance(repairs, bool) or not 0 <= repairs <= 3:
        fail("maximumRepairs must be an integer from 0 through 3")
    if policy["releaseOrder"] != list(RELEASE_ORDER):
        fail("releaseOrder must preserve every mandatory delivery gate")
    if policy["manualReviewBlocksRelease"] is not True:
        fail("manualReviewBlocksRelease must be true")
    return policy


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"invalid delivery policy: {exc}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, help="Optional project delivery-policy.json")
    parser.add_argument("--output", type=Path, help="Write the selected policy and canonical digest")
    args = parser.parse_args()
    try:
        source = args.policy if args.policy is not None else next((path for path in DEFAULT_CANDIDATES if path.is_file()), DEFAULT_CANDIDATES[0])
        policy = validate(read_json(source))
        result = {"ok": True, "source": "project" if args.policy else "default", "policy": policy, "digest": digest(policy)}
        encoded = json.dumps(result, ensure_ascii=True, sort_keys=True) + "\n"
        if args.output is not None:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(encoded, encoding="utf-8")
        print(encoded, end="")
        return 0
    except ValueError as exc:
        print(f"delivery policy invalid: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Validate the strict, score-only GDD EDD report contract."""

import argparse
import json
import pathlib
import sys
from typing import Any


DIMENSION_LIMITS = {
    "experienceValue": 30,
    "gameplaySystems": 40,
    "contentPresentation": 30,
}


def require_exact_keys(value: Any, required: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    missing = required - value.keys()
    unexpected = value.keys() - required
    if missing:
        raise ValueError(f"{label} is missing fields: {', '.join(sorted(missing))}")
    if unexpected:
        raise ValueError(f"{label} has unexpected fields: {', '.join(sorted(unexpected))}")
    return value


def require_string(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    if len(value) > maximum:
        raise ValueError(f"{label} must be at most {maximum} characters")
    return value


def require_string_list(value: Any, label: str, maximum_items: int) -> list[str]:
    if not isinstance(value, list) or len(value) > maximum_items:
        raise ValueError(f"{label} must be an array with at most {maximum_items} items")
    for index, item in enumerate(value):
        require_string(item, f"{label}[{index}]", 500)
    return value


def require_score(value: Any, label: str, maximum: int) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= maximum:
        raise ValueError(f"{label} must be a number between 0 and {maximum}")
    return float(value)


def validate_dimension(value: Any, key: str, maximum: int) -> float:
    dimension = require_exact_keys(
        value,
        {"score", "observations", "rationale", "evidenceGaps"},
        f"dimensions.{key}",
    )
    score = require_score(dimension["score"], f"{key}.score", maximum)
    observations = dimension["observations"]
    if not isinstance(observations, list) or not 1 <= len(observations) <= 20:
        raise ValueError(f"{key}.observations must contain between 1 and 20 items")
    for index, value in enumerate(observations):
        observation = require_exact_keys(
            value,
            {"statement", "evidence"},
            f"{key}.observations[{index}]",
        )
        require_string(observation["statement"], f"{key}.observations[{index}].statement", 500)
        require_string(observation["evidence"], f"{key}.observations[{index}].evidence", 300)
    require_string(dimension["rationale"], f"{key}.rationale", 1000)
    require_string_list(dimension["evidenceGaps"], f"{key}.evidenceGaps", 20)
    return score


def validate(report: Any) -> None:
    root = require_exact_keys(
        report,
        {"schemaVersion", "source", "dimensions", "totalScore", "confidence"},
        "report",
    )
    if root["schemaVersion"] != 1:
        raise ValueError("schemaVersion must be 1")

    source = require_exact_keys(
        root["source"],
        {"projectId", "documentId", "epoch", "revision", "title"},
        "source",
    )
    require_string(source["projectId"], "source.projectId", 200)
    require_string(source["documentId"], "source.documentId", 200)
    for token_field in ("epoch", "revision"):
        if (
            isinstance(source[token_field], bool)
            or not isinstance(source[token_field], int)
            or source[token_field] < 0
        ):
            raise ValueError(f"source.{token_field} must be a non-negative integer")
    require_string(source["title"], "source.title", 200)

    dimensions = require_exact_keys(root["dimensions"], set(DIMENSION_LIMITS), "dimensions")
    calculated_total = sum(
        validate_dimension(dimensions[key], key, maximum)
        for key, maximum in DIMENSION_LIMITS.items()
    )
    total = require_score(root["totalScore"], "totalScore", 100)
    if abs(total - calculated_total) > 0.001:
        raise ValueError("totalScore must equal the sum of all dimension scores")

    confidence = require_exact_keys(
        root["confidence"],
        {"level", "rationale", "limitations"},
        "confidence",
    )
    if confidence["level"] not in {"high", "medium", "low"}:
        raise ValueError("confidence.level must be high, medium, or low")
    require_string(confidence["rationale"], "confidence.rationale", 1000)
    require_string_list(confidence["limitations"], "confidence.limitations", 20)


def read_input(path: str) -> Any:
    if path == "-":
        return json.load(sys.stdin)
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="JSON report path, or - to read standard input")
    args = parser.parse_args()
    try:
        report = read_input(args.path)
        validate(report)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"invalid report: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"valid": True, "totalScore": report["totalScore"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

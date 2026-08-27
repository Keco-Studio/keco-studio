#!/usr/bin/env python3
"""Deterministic Slice evidence and status contracts."""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any


HASH_LENGTH = 71
OBSERVATION_KEYS = {
    "schemaVersion", "runId", "sliceId", "evalId", "buildHash",
    "snapshotHash", "actual", "errors",
}


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def sha256_canonical(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _pointer(value: Any, path: str) -> tuple[bool, Any]:
    if path == "":
        return True, value
    if not isinstance(path, str) or not path.startswith("/"):
        return False, None
    current = value
    for raw in path[1:].split("/"):
        key = raw.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list) and key.isdigit() and int(key) < len(current):
            current = current[int(key)]
        elif isinstance(current, dict) and key in current:
            current = current[key]
        else:
            return False, None
    return True, current


def _valid_identifier(value: Any) -> bool:
    return isinstance(value, str) and 0 < len(value) <= 100


def _valid_pointer(value: Any) -> bool:
    if not isinstance(value, str) or len(value) > 500:
        return False
    if value == "":
        return True
    if not value.startswith("/"):
        return False
    index = 0
    while index < len(value):
        if value[index] == "~":
            if index + 1 >= len(value) or value[index + 1] not in "01":
                return False
            index += 1
        index += 1
    return True


def _valid_hash(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == HASH_LENGTH
        and value.startswith("sha256:")
        and all(char in "0123456789abcdef" for char in value[7:])
    )


def _validate_assertion(assertion: Any) -> None:
    if not isinstance(assertion, dict) or not _valid_identifier(assertion.get("assertionId")):
        raise ValueError("assertionId must be a bounded non-empty string")
    kind = assertion.get("kind")
    if kind == "equals":
        if set(assertion) != {"assertionId", "kind", "path", "expected"} or not _valid_pointer(assertion.get("path")):
            raise ValueError("equals assertion has invalid fields")
        return
    if kind == "range":
        keys = {"assertionId", "kind", "path", "minimumInclusive", "maximumInclusive"}
        keys.update(key for key in ("minimum", "maximum") if key in assertion)
        minimum = assertion.get("minimum")
        maximum = assertion.get("maximum")
        if (
            set(assertion) != keys
            or not _valid_pointer(assertion.get("path"))
            or (minimum is None and maximum is None)
            or any(
                value is not None
                and (not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value))
                for value in (minimum, maximum)
            )
            or (minimum is not None and maximum is not None and minimum > maximum)
            or not isinstance(assertion.get("minimumInclusive"), bool)
            or not isinstance(assertion.get("maximumInclusive"), bool)
        ):
            raise ValueError("range assertion has invalid fields")
        return
    if kind == "subset":
        expected = assertion.get("expected")
        if (
            set(assertion) != {"assertionId", "kind", "path", "expected"}
            or not _valid_pointer(assertion.get("path"))
            or not isinstance(expected, (list, dict))
            or len(expected) > 100
        ):
            raise ValueError("subset assertion has invalid fields")
        return
    if kind == "roundtrip":
        markers = assertion.get("markerPaths")
        if (
            set(assertion) != {"assertionId", "kind", "beforePath", "afterPath", "markerPaths"}
            or not _valid_pointer(assertion.get("beforePath"))
            or not _valid_pointer(assertion.get("afterPath"))
            or not isinstance(markers, list)
            or not 0 < len(markers) <= 20
            or any(not _valid_pointer(path) for path in markers)
            or len(set(markers)) != len(markers)
        ):
            raise ValueError("roundtrip assertion has invalid fields")
        return
    raise ValueError(f"unsupported assertion kind: {kind}")


def _validate_spec(spec: Any) -> None:
    if not isinstance(spec, dict):
        raise ValueError("evaluation spec must be an object")
    keys = {"evalId", "buildHash", "snapshotHash", "assertions"}
    if "manualRequired" in spec:
        keys.add("manualRequired")
    assertions = spec.get("assertions")
    if (
        set(spec) != keys
        or not _valid_identifier(spec.get("evalId"))
        or not _valid_hash(spec.get("buildHash"))
        or not _valid_hash(spec.get("snapshotHash"))
        or not isinstance(assertions, list)
        or not 0 < len(assertions) <= 100
        or ("manualRequired" in spec and not isinstance(spec["manualRequired"], bool))
    ):
        raise ValueError("evaluation spec has invalid fields")
    for assertion in assertions:
        _validate_assertion(assertion)
    assertion_ids = [assertion["assertionId"] for assertion in assertions]
    if len(assertion_ids) != len(set(assertion_ids)):
        raise ValueError("evaluation assertion IDs must be unique")


def parse_observation(value: Any, *, legacy: bool = False) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("runtime observation must be an object")
    if legacy:
        value = {
            "schemaVersion": 1,
            "runId": value.get("runId", "legacy-run"),
            "sliceId": value.get("sliceId", "legacy-slice"),
            "evalId": value.get("evalId"),
            "buildHash": value.get("buildHash"),
            "snapshotHash": value.get("snapshotHash"),
            "actual": value.get("actual"),
            "errors": value.get("errors", []),
        }
    if set(value) != OBSERVATION_KEYS or value.get("schemaVersion") != 1:
        raise ValueError("runtime observation has invalid fields")
    for key in ("runId", "sliceId", "evalId"):
        if not _valid_identifier(value[key]):
            raise ValueError(f"{key} must be a bounded non-empty string")
    for key in ("buildHash", "snapshotHash"):
        if not _valid_hash(value[key]):
            raise ValueError(f"{key} must be a sha256 digest")
    if not isinstance(value["actual"], dict) or len(value["actual"]) > 1000:
        raise ValueError("actual must be an object")
    if (
        not isinstance(value["errors"], list)
        or len(value["errors"]) > 100
        or any(not isinstance(item, str) or len(item) > 1000 for item in value["errors"])
    ):
        raise ValueError("errors must be an array of strings")
    return value


def _assertion_result(assertion: dict[str, Any], status: str, expected: Any, actual: Any, reason: str) -> dict[str, Any]:
    return {"assertionId": assertion.get("assertionId"), "status": status, "expected": expected, "actual": actual, "reasonCode": reason}


def _evaluate_assertion(assertion: dict[str, Any], root: dict[str, Any]) -> dict[str, Any]:
    kind = assertion.get("kind")
    if kind == "roundtrip":
        before_found, before = _pointer(root, assertion.get("beforePath"))
        after_found, after = _pointer(root, assertion.get("afterPath"))
        if not before_found or not after_found:
            return _assertion_result(assertion, "failed", before, after, "ACTUAL_PATH_MISSING")
        markers = assertion.get("markerPaths")
        if not isinstance(markers, list):
            raise ValueError("roundtrip markerPaths must be an array")
        missing = next((path for path in markers if not _pointer(root, path)[0]), None)
        if missing is not None:
            return _assertion_result(assertion, "failed", markers, missing, "ROUNDTRIP_MARKER_MISSING")
        passed = canonical_json(before) == canonical_json(after)
        return _assertion_result(assertion, "passed" if passed else "failed", before, after, "OK" if passed else "ROUNDTRIP_MISMATCH")
    found, actual = _pointer(root, assertion.get("path"))
    expected = assertion.get("expected") if kind != "range" else {"minimum": assertion.get("minimum"), "maximum": assertion.get("maximum")}
    if not found:
        return _assertion_result(assertion, "failed", expected, None, "ACTUAL_PATH_MISSING")
    if kind == "equals":
        passed = canonical_json(actual) == canonical_json(expected)
        return _assertion_result(assertion, "passed" if passed else "failed", expected, actual, "OK" if passed else "VALUE_MISMATCH")
    if kind == "subset":
        if isinstance(expected, list) and isinstance(actual, list):
            passed = all(any(canonical_json(candidate) == canonical_json(item) for item in actual) for candidate in expected)
        elif isinstance(expected, dict) and isinstance(actual, dict):
            passed = all(key in actual and canonical_json(actual[key]) == canonical_json(candidate) for key, candidate in expected.items())
        else:
            passed = False
        return _assertion_result(assertion, "passed" if passed else "failed", expected, actual, "OK" if passed else "SUBSET_MISMATCH")
    if not isinstance(actual, (int, float)) or isinstance(actual, bool) or not math.isfinite(actual):
        return _assertion_result(assertion, "failed", expected, actual, "RANGE_VALUE_INVALID")
    minimum = assertion.get("minimum")
    maximum = assertion.get("maximum")
    above = minimum is None or (
        actual >= minimum if assertion["minimumInclusive"] else actual > minimum
    )
    below = maximum is None or (
        actual <= maximum if assertion["maximumInclusive"] else actual < maximum
    )
    passed = above and below
    return _assertion_result(assertion, "passed" if passed else "failed", expected, actual, "OK" if passed else "RANGE_OUT_OF_BOUNDS")


def evaluate_observation(spec: dict[str, Any], observation: dict[str, Any]) -> dict[str, Any]:
    _validate_spec(spec)
    observation = parse_observation(observation)
    if spec.get("evalId") != observation.get("evalId"):
        raise ValueError("evaluation identity does not match")
    manual_required = spec.get("manualRequired") is True
    for field, reason in (("buildHash", "BUILD_HASH_MISMATCH"), ("snapshotHash", "SNAPSHOT_HASH_MISMATCH")):
        if spec.get(field) != observation.get(field):
            return {"evalId": spec["evalId"], "status": "failed", "manualRequired": manual_required, "assertions": [], "reasonCodes": [reason]}
    if observation["errors"]:
        return {"evalId": spec["evalId"], "status": "failed", "manualRequired": manual_required, "assertions": [], "reasonCodes": ["RUNTIME_ERRORS"]}
    results = [_evaluate_assertion(assertion, observation["actual"]) for assertion in spec["assertions"]]
    reasons = [item["reasonCode"] for item in results if item["status"] == "failed"]
    status = "failed" if reasons else "passed"
    return {"evalId": spec["evalId"], "status": status, "manualRequired": manual_required, "assertions": results, "reasonCodes": reasons}


def derive_slice_status(value: dict[str, Any]) -> dict[str, str]:
    tasks = value.get("tasks", [])
    evaluations = value.get("evaluations", [])
    tasks_complete = bool(tasks) and all(item.get("status") == "completed" and item.get("resultAccepted") is True and item.get("reviewAccepted") is True for item in tasks)
    if any(item.get("status") == "failed" for item in tasks):
        implementation = "failed"
    elif any(item.get("status") == "blocked" for item in tasks):
        implementation = "blocked"
    elif tasks_complete:
        implementation = "completed"
    elif any(item.get("status") == "in_progress" for item in tasks):
        implementation = "in_progress"
    else:
        implementation = "pending"
    if not evaluations:
        runtime = "not_run"
    elif any(item.get("status") == "failed" for item in evaluations):
        runtime = "failed"
    elif any(item.get("status") == "blocked" for item in evaluations):
        runtime = "blocked"
    elif all(item.get("status") in {"passed", "manual_required"} for item in evaluations):
        runtime = "passed"
    else:
        runtime = "partial"
    manual = value.get("manualRequired") is True
    acceptance = "failed" if runtime == "failed" else "pending" if runtime == "not_run" else "manual_required" if manual else "passed" if runtime == "passed" else "partial"
    if value.get("policyBlocked"):
        release = "blocked_by_policy"
    elif implementation == "failed" or acceptance == "failed":
        release = "failed"
    elif implementation != "completed" or runtime != "passed":
        release = "blocked_by_verification"
    elif manual:
        release = "blocked_by_manual_review"
    elif value.get("mirrorsVerified") and value.get("packageReady", True):
        release = "ready"
    else:
        release = "not_ready"
    return {"implementationStatus": implementation, "runtimeVerificationStatus": runtime, "acceptanceStatus": acceptance, "releaseReadiness": release}

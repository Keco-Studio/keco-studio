#!/usr/bin/env python3
"""Deterministic Slice evidence and status contracts."""
from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any


HASH_LENGTH = 71
OBSERVATION_KEYS = {
    "schemaVersion", "runId", "sliceId", "evalId", "buildHash",
    "snapshotHash", "actual", "errors",
}
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.IGNORECASE)
IDENTIFIER_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,99}$")


def _manifest_path() -> Path:
    root = Path(__file__).resolve().parent.parent
    candidates = (
        root / "references" / "contract-manifest.json",
        root / "skills" / "keco-develop-godot-slice-v2" / "references" / "contract-manifest.json",
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise ValueError("Slice V2 contract manifest is missing")


def load_contract_manifest() -> dict[str, Any]:
    value = json.loads(_manifest_path().read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("contractVersion") != 2:
        raise ValueError("Slice V2 contract manifest is invalid")
    return value


def _decision(accepted: bool, reason_code: str) -> dict[str, Any]:
    return {"accepted": accepted, "reasonCode": None if accepted else reason_code}


def _record(value: Any) -> bool:
    return isinstance(value, dict)


def _exact_keys(value: dict[str, Any], keys: set[str]) -> bool:
    return set(value) == keys


def _strings(value: Any, *, allow_empty: bool = False) -> bool:
    return (
        isinstance(value, list)
        and (allow_empty or bool(value))
        and all(isinstance(item, str) and bool(item) for item in value)
        and len(value) == len(set(value))
    )


def safe_repository_path(value: Any) -> bool:
    if not isinstance(value, str) or not 0 < len(value) <= 500:
        return False
    if value.startswith(("/", "\\")) or "\\" in value or re.match(r"^[A-Za-z]:", value):
        return False
    return all(segment not in {"", ".", ".."} for segment in value.split("/"))


def _timestamp(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def _source_profile(value: Any, manifest: dict[str, Any]) -> dict[str, Any]:
    reason = "SLICE_SOURCE_PROFILE_INVALID"
    if not _record(value):
        return _decision(False, reason)
    common = {"schemaVersion", "contractVersion", "kind", "kecoProjectId", "capturedAt", "sourceHash", "selectionEvidence"}
    if (
        value.get("schemaVersion") != 1
        or value.get("contractVersion") != 2
        or value.get("kind") not in manifest["sourceProfileKinds"]
        or not isinstance(value.get("kecoProjectId"), str)
        or not UUID_RE.fullmatch(value["kecoProjectId"])
        or not _timestamp(value.get("capturedAt"))
        or not _valid_hash(value.get("sourceHash"))
        or not isinstance(value.get("selectionEvidence"), list)
        or any(not _record(item) for item in value["selectionEvidence"])
    ):
        return _decision(False, reason)
    kind = value["kind"]
    if kind in manifest["documentBackedKinds"]:
        extra = {"documentId", "epoch", "revision", "contentHash"}
        if kind == "gdd":
            extra.add("requirementInventoryHash")
        if (
            not _exact_keys(value, common | extra)
            or not isinstance(value.get("documentId"), str)
            or not UUID_RE.fullmatch(value["documentId"])
            or type(value.get("epoch")) is not int
            or value["epoch"] < 0
            or type(value.get("revision")) is not int
            or value["revision"] < 0
            or not _valid_hash(value.get("contentHash"))
            or (kind == "gdd" and not _valid_hash(value.get("requirementInventoryHash")))
        ):
            return _decision(False, reason)
        return _decision(True, reason)
    if kind == "table":
        row_ids = value.get("rowIds")
        row_hashes = value.get("rowHashes")
        if (
            not _exact_keys(value, common | {"tableId", "schemaHash", "rowIds", "rowHashes", "contentHash"})
            or not isinstance(value.get("tableId"), str)
            or not UUID_RE.fullmatch(value["tableId"])
            or not _valid_hash(value.get("schemaHash"))
            or not _strings(row_ids, allow_empty=True)
            or any(not UUID_RE.fullmatch(item) for item in row_ids)
            or not isinstance(row_hashes, dict)
            or set(row_hashes) != set(row_ids)
            or any(not _valid_hash(item) for item in row_hashes.values())
            or not _valid_hash(value.get("contentHash"))
        ):
            return _decision(False, reason)
        return _decision(True, reason)
    if (
        not _exact_keys(value, common | {"requestHash", "requestExcerpt"})
        or not _valid_hash(value.get("requestHash"))
        or not isinstance(value.get("requestExcerpt"), str)
        or not value["requestExcerpt"].strip()
        or len(value["requestExcerpt"]) > 4000
    ):
        return _decision(False, reason)
    return _decision(True, reason)


def _document_bindings(value: Any, manifest: dict[str, Any]) -> dict[str, Any]:
    reason = "SLICE_DOCUMENT_PLACEMENT_INVALID"
    if not _record(value):
        return _decision(False, reason)
    slice_id = value.get("sliceId")
    roots = [value.get("planningRootId"), value.get("specFolderId"), value.get("planFolderId")]
    bindings = value.get("documentBindings")
    if (
        not isinstance(slice_id, str)
        or not IDENTIFIER_RE.fullmatch(slice_id)
        or any(not isinstance(item, str) or not UUID_RE.fullmatch(item) for item in roots)
        or roots[1] == roots[2]
        or not isinstance(bindings, list)
        or len(bindings) != 3
    ):
        return _decision(False, reason)
    folders = {"roadmap": roots[0], "spec": roots[1], "plan": roots[2]}
    paths = {
        "roadmap": manifest["canonicalPaths"]["roadmap"],
        "spec": f'{manifest["canonicalPaths"]["specPrefix"]}{slice_id}{manifest["canonicalPaths"]["specSuffix"]}',
        "plan": f'{manifest["canonicalPaths"]["planPrefix"]}{slice_id}{manifest["canonicalPaths"]["planSuffix"]}',
    }
    seen: set[str] = set()
    for item in bindings:
        if not _record(item):
            return _decision(False, reason)
        kind = item.get("kind")
        disposition = item.get("disposition")
        base = {"kind", "disposition", "folderId", "name", "repositoryPath"}
        if (
            kind not in manifest["documentKinds"]
            or kind in seen
            or disposition not in manifest["documentDispositions"]
            or item.get("folderId") != folders[kind]
            or item.get("name") != ("roadmap" if kind == "roadmap" else slice_id)
            or item.get("repositoryPath") != paths[kind]
        ):
            return _decision(False, reason)
        if disposition == "create":
            valid = _exact_keys(item, base | {"markdown"}) and isinstance(item.get("markdown"), str)
        elif disposition == "bind":
            valid = (
                _exact_keys(item, base | {"documentId", "expectedEpoch", "expectedRevision", "contentHash"})
                and isinstance(item.get("documentId"), str)
                and bool(UUID_RE.fullmatch(item["documentId"]))
                and type(item.get("expectedEpoch")) is int
                and item["expectedEpoch"] >= 0
                and type(item.get("expectedRevision")) is int
                and item["expectedRevision"] >= 0
                and _valid_hash(item.get("contentHash"))
            )
        else:
            valid = (
                _exact_keys(item, base | {"documentId", "expectedEpoch", "expectedRevision", "priorContentHash", "markdown"})
                and isinstance(item.get("documentId"), str)
                and bool(UUID_RE.fullmatch(item["documentId"]))
                and type(item.get("expectedEpoch")) is int
                and item["expectedEpoch"] >= 0
                and type(item.get("expectedRevision")) is int
                and item["expectedRevision"] >= 0
                and _valid_hash(item.get("priorContentHash"))
                and isinstance(item.get("markdown"), str)
            )
        if not valid:
            return _decision(False, reason)
        seen.add(kind)
    return _decision(True, reason)


def _plan_eval(value: Any, manifest: dict[str, Any]) -> dict[str, Any]:
    if not _record(value) or not _record(value.get("plan")) or not _record(value.get("evalSpec")):
        return _decision(False, "SLICE_PLAN_SCOPE_INVALID")
    plan = value["plan"]
    eval_spec = value["evalSpec"]
    allowed = plan.get("allowedFiles")
    tasks = plan.get("tasks")
    if (
        plan.get("schemaVersion") != 2
        or not _strings(allowed)
        or any(not safe_repository_path(item) for item in allowed)
        or not isinstance(tasks, list)
        or not tasks
    ):
        return _decision(False, "SLICE_PLAN_SCOPE_INVALID")
    if plan.get("coverageMode") == "gdd":
        if not _strings(plan.get("requirementIds")) or not _valid_hash(plan.get("inventoryHash")) or "nonGddRationale" in plan:
            return _decision(False, "SLICE_PLAN_SCOPE_INVALID")
    elif (
        plan.get("coverageMode") != "non_gdd"
        or not isinstance(plan.get("nonGddRationale"), str)
        or not plan["nonGddRationale"].strip()
        or not _valid_hash(plan.get("sourceProfileHash"))
        or "requirementIds" in plan
        or "inventoryHash" in plan
    ):
        return _decision(False, "SLICE_PLAN_SCOPE_INVALID")
    task_ids: set[str] = set()
    owned: set[str] = set()
    for task in tasks:
        if (
            not _record(task)
            or not isinstance(task.get("id"), str)
            or not IDENTIFIER_RE.fullmatch(task["id"])
            or task["id"] in task_ids
            or not _strings(task.get("files"))
            or any(item not in allowed for item in task["files"])
            or not _strings(task.get("dependsOn"), allow_empty=True)
            or any(item == task["id"] or item not in task_ids for item in task["dependsOn"])
            or not _strings(task.get("servesEvaluations"))
            or not _record(task.get("red"))
            or task["red"].get("expected") != "fails"
            or not isinstance(task["red"].get("command"), str)
            or not task["red"]["command"].strip()
            or not _record(task.get("green"))
            or task["green"].get("expected") != "passes"
            or not isinstance(task["green"].get("command"), str)
            or not task["green"]["command"].strip()
            or not _record(task.get("review"))
            or task["review"].get("minimumLevel") not in manifest["reviewLevels"]
            or not _strings(task.get("sourceMappings"))
        ):
            return _decision(False, "SLICE_PLAN_SCOPE_INVALID")
        task_ids.add(task["id"])
        owned.update(task["files"])
    if any(item not in owned for item in allowed):
        return _decision(False, "SLICE_PLAN_SCOPE_INVALID")
    evaluations = eval_spec.get("evaluations")
    if (
        eval_spec.get("schemaVersion") != 2
        or eval_spec.get("coverageMode") != plan.get("coverageMode")
        or (plan.get("coverageMode") == "non_gdd" and eval_spec.get("sourceProfileHash") != plan.get("sourceProfileHash"))
        or not isinstance(evaluations, list)
        or not evaluations
    ):
        return _decision(False, "SLICE_EVAL_BINDING_INVALID")
    if plan.get("coverageMode") == "gdd" and (
        eval_spec.get("inventoryHash") != plan.get("inventoryHash")
        or eval_spec.get("requirementIds") != plan.get("requirementIds")
    ):
        return _decision(False, "SLICE_EVAL_BINDING_INVALID")
    eval_ids: set[str] = set()
    reverse: dict[str, set[str]] = {}
    for evaluation in evaluations:
        if (
            not _record(evaluation)
            or not isinstance(evaluation.get("evalId"), str)
            or not IDENTIFIER_RE.fullmatch(evaluation["evalId"])
            or evaluation["evalId"] in eval_ids
            or not _strings(evaluation.get("servedByTasks"))
            or any(item not in task_ids for item in evaluation["servedByTasks"])
            or not isinstance(evaluation.get("assertions"), list)
            or not evaluation["assertions"]
        ):
            return _decision(False, "SLICE_EVAL_BINDING_INVALID")
        eval_ids.add(evaluation["evalId"])
        reverse[evaluation["evalId"]] = set(evaluation["servedByTasks"])
    for task in tasks:
        for eval_id in task["servesEvaluations"]:
            if eval_id not in eval_ids or task["id"] not in reverse[eval_id]:
                return _decision(False, "SLICE_EVAL_BINDING_INVALID")
    for eval_id, serving_tasks in reverse.items():
        for task_id in serving_tasks:
            task = next(item for item in tasks if item["id"] == task_id)
            if eval_id not in task["servesEvaluations"]:
                return _decision(False, "SLICE_EVAL_BINDING_INVALID")
    return _decision(True, "SLICE_EVAL_BINDING_INVALID")


def validate_contract_case(boundary: str, value: Any) -> dict[str, Any]:
    manifest = load_contract_manifest()
    if boundary == "sourceProfile":
        return _source_profile(value, manifest)
    if boundary == "documentBindings":
        return _document_bindings(value, manifest)
    if boundary == "planEval":
        return _plan_eval(value, manifest)
    if boundary == "review":
        reason = "SLICE_REVIEW_LEVEL_INVALID"
        if not _record(value) or value.get("requestedLevel") not in manifest["reviewLevels"]:
            return _decision(False, reason)
        if value["requestedLevel"] == "independent_actor":
            return _decision(isinstance(value.get("taskResultActor"), str) and isinstance(value.get("reviewActor"), str) and value["taskResultActor"] != value["reviewActor"], reason)
        if value["requestedLevel"] == "separate_context":
            return _decision(value.get("trustedContext") is True and isinstance(value.get("taskExecutionContext"), str) and isinstance(value.get("reviewExecutionContext"), str) and value["taskExecutionContext"] != value["reviewExecutionContext"], reason)
        return _decision(True, reason)
    if boundary == "runtimeEvidence":
        valid = _record(value) and (
            (value.get("contractVersion") == 2 and value.get("prefix") == manifest["runtimePrefixes"]["current"] and value.get("legacyAdapter") is not True)
            or (value.get("contractVersion") == 1 and value.get("prefix") == manifest["runtimePrefixes"]["legacy"] and value.get("legacyAdapter") is True)
        )
        return _decision(valid, "SLICE_RUNTIME_EVIDENCE_INVALID")
    if boundary == "state":
        valid = _record(value) and isinstance(value.get("expectedStateToken"), str) and value.get("expectedStateToken") == value.get("currentStateToken")
        return _decision(valid, "SLICE_STATE_CONFLICT")
    if boundary == "repair":
        valid = _record(value) and type(value.get("repairCount")) is int and type(value.get("requestedTransitions")) is int and value["repairCount"] >= 0 and value["requestedTransitions"] > 0 and value["repairCount"] + value["requestedTransitions"] <= manifest["maximumRepairs"]
        return _decision(valid, "SLICE_REPAIR_LIMIT")
    raise ValueError(f"unsupported Slice V2 contract boundary: {boundary}")


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

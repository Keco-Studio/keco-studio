#!/usr/bin/env python3
"""Fail closed when a GameEvaluationReport is incomplete or contradictory."""

import argparse
import json
import pathlib
import sys
from typing import Any


DECISIONS = {"passed", "conditional", "partial", "failed", "blocked"}
ITEM_STATUSES = {"evaluated", "not_applicable", "not_evaluated"}
SEVERITIES = ("P0", "P1", "P2", "P3")
THRESHOLDS = {"alpha": 60, "beta": 70, "rc": 80, "release": 85}


def non_empty_strings(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(
        isinstance(item, str) and item.strip() for item in value
    )


def validate(report: Any) -> None:
    if not isinstance(report, dict) or report.get("version") != 1:
        raise ValueError("report must be a version 1 object")
    required = {
        "reportId", "profileId", "buildHash", "gddRevision", "stage", "genre",
        "score", "coverage", "subjective", "confidence", "itemResults",
        "mandatoryEvaluations", "findings", "severityCounts", "decision",
        "rawResultReferences",
    }
    if required - report.keys():
        raise ValueError("report lacks required fields, including raw result references")
    if report["reportId"] != f"{report['profileId']}-report":
        raise ValueError("reportId identity does not match profileId")
    if not all(isinstance(report[key], str) and report[key].strip() for key in (
        "profileId", "buildHash", "gddRevision", "stage", "genre"
    )):
        raise ValueError("report identity fields must be non-empty strings")

    score = report["score"]
    if not isinstance(score, dict) or {"total", "formalTotal", "generalWeight", "specializedWeight", "groups"} - score.keys():
        raise ValueError("score lacks required fields")
    if score["generalWeight"] != 80 or score["specializedWeight"] != 20 or score["generalWeight"] + score["specializedWeight"] != 100:
        raise ValueError("score weights must total 100 as 80 general plus 20 specialized")
    if not isinstance(score["total"], (int, float)) or isinstance(score["total"], bool) or not 0 <= score["total"] <= 100:
        raise ValueError("score total must be between 0 and 100")
    if score["formalTotal"] is not None and (
        not isinstance(score["formalTotal"], (int, float))
        or isinstance(score["formalTotal"], bool)
        or not 0 <= score["formalTotal"] <= 100
    ):
        raise ValueError("formal score must be null or between 0 and 100")
    coverage = report["coverage"]
    if not isinstance(coverage, (int, float)) or isinstance(coverage, bool) or not 0 <= coverage <= 1:
        raise ValueError("coverage must be between 0 and 1")
    if coverage < 0.7 and score["formalTotal"] is not None:
        raise ValueError("coverage below 70 percent cannot have a formal score")

    groups = score["groups"]
    if not isinstance(groups, dict) or not groups:
        raise ValueError("score groups must be a non-empty object")
    group_score = 0.0
    group_weight = 0
    for group_id, group in groups.items():
        if not isinstance(group_id, str) or not isinstance(group, dict) or {"weight", "score", "coverage"} - group.keys():
            raise ValueError("score group is invalid")
        if not isinstance(group["weight"], int) or isinstance(group["weight"], bool) or group["weight"] <= 0:
            raise ValueError("score group weight is invalid")
        if not isinstance(group["score"], (int, float)) or isinstance(group["score"], bool) or not 0 <= group["score"] <= group["weight"]:
            raise ValueError("score group value is outside its weight")
        if not isinstance(group["coverage"], (int, float)) or not 0 <= group["coverage"] <= 1:
            raise ValueError("score group coverage is invalid")
        group_score += group["score"]
        group_weight += group["weight"]
    if group_weight != 100 or abs(group_score - score["total"]) > 0.02:
        raise ValueError("score groups must total the configured weight and score")

    items = report["itemResults"]
    if not isinstance(items, list) or not items:
        raise ValueError("itemResults must be a non-empty array")
    metric_ids: set[str] = set()
    for item in items:
        if not isinstance(item, dict) or not {"metricId", "status", "evidence"}.issubset(item):
            raise ValueError("item result lacks required fields")
        if not isinstance(item["metricId"], str) or item["metricId"] in metric_ids:
            raise ValueError("item metric IDs must be unique")
        if item["status"] not in ITEM_STATUSES:
            raise ValueError("item result status is invalid")
        if item["status"] == "evaluated" and (
            not isinstance(item.get("rating"), (int, float))
            or isinstance(item.get("rating"), bool)
            or not 1 <= item["rating"] <= 5
            or not non_empty_strings(item["evidence"])
        ):
            raise ValueError("evaluated item requires a 1-5 rating and evidence")
        metric_ids.add(item["metricId"])

    mandatory = report["mandatoryEvaluations"]
    if not isinstance(mandatory, list) or not mandatory:
        raise ValueError("mandatoryEvaluations must be a non-empty array")
    mandatory_ids: set[str] = set()
    for item in mandatory:
        if not isinstance(item, dict) or not {"evalId", "status", "evidence"}.issubset(item):
            raise ValueError("mandatory evaluation lacks required fields")
        if not isinstance(item["evalId"], str) or item["evalId"] in mandatory_ids or not non_empty_strings(item["evidence"]):
            raise ValueError("mandatory evaluation IDs and evidence are invalid")
        mandatory_ids.add(item["evalId"])

    findings = report["findings"]
    if not isinstance(findings, list):
        raise ValueError("findings must be an array")
    issue_ids: set[str] = set()
    counted = {severity: 0 for severity in SEVERITIES}
    for finding in findings:
        if not isinstance(finding, dict) or not {"issueId", "severity", "primaryMetricId", "evidence"}.issubset(finding):
            raise ValueError("finding lacks required fields")
        if not isinstance(finding["issueId"], str) or finding["issueId"] in issue_ids:
            raise ValueError("duplicate issue ID")
        if finding["severity"] not in counted or finding["primaryMetricId"] not in metric_ids or not non_empty_strings(finding["evidence"]):
            raise ValueError("finding severity, primary metric, or evidence is invalid")
        issue_ids.add(finding["issueId"])
        counted[finding["severity"]] += 1
    if report["severityCounts"] != counted:
        raise ValueError("severity counts do not match findings")

    references = report["rawResultReferences"]
    if not isinstance(references, dict) or {"metricIds", "subjectiveGroupIds", "mandatoryEvaluationIds"} - references.keys():
        raise ValueError("raw result references are incomplete")
    if references["metricIds"] != [item["metricId"] for item in items] or references["mandatoryEvaluationIds"] != [item["evalId"] for item in mandatory]:
        raise ValueError("raw result references do not match report results")

    decision = report["decision"]
    if not isinstance(decision, dict) or {"stage", "status", "threshold", "reasons"} - decision.keys():
        raise ValueError("decision lacks required fields")
    if decision["stage"] != report["stage"] or decision["status"] not in DECISIONS or not isinstance(decision["reasons"], list):
        raise ValueError("decision stage or status is invalid")
    stage = report["stage"]
    status = decision["status"]
    if stage in {"rc", "release"} and status == "conditional":
        raise ValueError("RC and Release cannot be conditional")
    threshold = THRESHOLDS.get(stage)
    if decision["threshold"] != threshold:
        raise ValueError("decision threshold does not match stage")
    if status == "passed":
        if threshold is not None and score["total"] < threshold:
            name = "Release" if stage == "release" else stage
            raise ValueError(f"{name} passed score must meet threshold {threshold}")
        if counted["P0"] or counted["P1"]:
            raise ValueError("passed report cannot contain P0 or P1 findings")
        if any(item["status"] != "passed" for item in mandatory):
            raise ValueError("passed report requires all mandatory evaluations passed")
        required_coverage = 1.0 if stage in {"rc", "release"} else 0.9 if stage == "beta" else 0.7
        if coverage < required_coverage:
            raise ValueError(f"{stage} passed report has insufficient coverage")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=pathlib.Path)
    args = parser.parse_args()
    try:
        report = json.loads(args.path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"invalid report: {exc}", file=sys.stderr)
        return 2
    try:
        validate(report)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps({
        "ok": True,
        "status": report["decision"]["status"],
        "stage": report["stage"],
        "score": report["score"]["total"],
        "coverage": report["coverage"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

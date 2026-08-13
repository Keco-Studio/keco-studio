#!/usr/bin/env python3
"""Score locked EDD profile evidence and apply fixed game stage gates."""

import argparse
import json
import pathlib
import statistics
import sys
from typing import Any


ITEM_STATUSES = {"evaluated", "not_applicable", "not_evaluated"}
EVAL_STATUSES = {"passed", "failed", "manual_required", "blocked"}
SEVERITIES = ("P0", "P1", "P2", "P3")
EXPERIENCE_GROUPS = {
    "general.core",
    "general.clarity",
    "general.interaction",
    "general.pacing",
    "general.systems",
    "general.presentation",
    "specialized",
}
STAGE_COVERAGE = {"alpha": 0.7, "beta": 0.9, "rc": 1.0, "release": 1.0}


def load_json(path: pathlib.Path, label: str) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid {label}: {exc}") from exc


def non_empty_strings(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(
        isinstance(item, str) and item.strip() for item in value
    )


def rounded(value: float) -> float:
    return round(value + 0.0, 4)


def validate_profile(profile: Any) -> tuple[list[dict[str, Any]], dict[str, int]]:
    if not isinstance(profile, dict) or profile.get("version") != 1:
        raise ValueError("profile must be a version 1 object")
    required = {"profileId", "buildHash", "gddRevision", "stage", "genre", "thresholds", "generalMetrics", "specializedMetrics"}
    if required - profile.keys():
        raise ValueError("profile lacks required fields")
    metrics = profile["generalMetrics"] + profile["specializedMetrics"] if (
        isinstance(profile["generalMetrics"], list) and isinstance(profile["specializedMetrics"], list)
    ) else []
    if not metrics:
        raise ValueError("profile metrics must be non-empty arrays")
    ids: set[str] = set()
    group_weights: dict[str, int] = {}
    for metric in metrics:
        if not isinstance(metric, dict) or not {"id", "groupId", "weight"}.issubset(metric):
            raise ValueError("profile metric lacks id, groupId, or weight")
        metric_id = metric["id"]
        group_id = metric["groupId"]
        weight = metric["weight"]
        if not isinstance(metric_id, str) or metric_id in ids:
            raise ValueError("profile metric IDs must be unique strings")
        if not isinstance(group_id, str) or not isinstance(weight, int) or isinstance(weight, bool) or weight <= 0:
            raise ValueError("profile metric group and weight are invalid")
        ids.add(metric_id)
        group_weights[group_id] = group_weights.get(group_id, 0) + weight
    general_weight = sum(item["weight"] for item in profile["generalMetrics"])
    specialized_weight = sum(item["weight"] for item in profile["specializedMetrics"])
    if general_weight != 80 or specialized_weight != 20:
        raise ValueError("profile must contain 80 general and 20 specialized points")
    return metrics, group_weights


def validate_item_results(evidence: dict[str, Any], metrics: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    results = evidence.get("itemResults")
    if not isinstance(results, list):
        raise ValueError("itemResults must be an array")
    metric_ids = {item["id"] for item in metrics}
    by_id: dict[str, dict[str, Any]] = {}
    for result in results:
        if not isinstance(result, dict) or not {"metricId", "status", "evidence"}.issubset(result):
            raise ValueError("item result lacks metricId, status, or evidence")
        metric_id = result["metricId"]
        status = result["status"]
        if not isinstance(metric_id, str) or metric_id not in metric_ids:
            raise ValueError("item result references an unknown metric")
        if metric_id in by_id:
            raise ValueError("duplicate metric result")
        if status not in ITEM_STATUSES:
            raise ValueError("invalid item result status")
        rating = result.get("rating")
        refs = result["evidence"]
        if status == "evaluated":
            if not isinstance(rating, (int, float)) or isinstance(rating, bool) or not 1 <= rating <= 5:
                raise ValueError("evaluated item rating must be between 1 and 5")
            if not non_empty_strings(refs):
                raise ValueError("evaluated item requires evidence")
        elif rating is not None or not isinstance(refs, list):
            raise ValueError("unevaluated item must omit rating and use an evidence array")
        by_id[metric_id] = result
    if set(by_id) != metric_ids:
        raise ValueError("itemResults must contain every profile metric exactly once")
    return by_id


def validate_subjective_results(evidence: dict[str, Any]) -> dict[str, dict[str, Any]]:
    values = evidence.get("subjectiveResults", [])
    if not isinstance(values, list):
        raise ValueError("subjectiveResults must be an array")
    result: dict[str, dict[str, Any]] = {}
    for item in values:
        if not isinstance(item, dict) or not {"groupId", "ratings", "evidence"}.issubset(item):
            raise ValueError("subjective result lacks groupId, ratings, or evidence")
        group_id = item["groupId"]
        ratings = item["ratings"]
        if group_id not in EXPERIENCE_GROUPS or group_id in result:
            raise ValueError("subjective group is unknown or duplicated")
        if not isinstance(ratings, list) or not ratings or any(
            not isinstance(value, (int, float)) or isinstance(value, bool) or not 1 <= value <= 10
            for value in ratings
        ):
            raise ValueError("subjective ratings must be a non-empty array of values from 1 to 10")
        if not non_empty_strings(item["evidence"]):
            raise ValueError("subjective result requires evidence")
        result[group_id] = item
    return result


def validate_mandatory(evidence: dict[str, Any]) -> list[dict[str, Any]]:
    values = evidence.get("mandatoryEvaluations")
    if not isinstance(values, list) or not values:
        raise ValueError("mandatoryEvaluations must be a non-empty array")
    ids: set[str] = set()
    for item in values:
        if not isinstance(item, dict) or not {"evalId", "status", "evidence"}.issubset(item):
            raise ValueError("mandatory evaluation lacks evalId, status, or evidence")
        if not isinstance(item["evalId"], str) or item["evalId"] in ids:
            raise ValueError("mandatory evaluation IDs must be unique")
        if item["status"] not in EVAL_STATUSES:
            raise ValueError("invalid mandatory evaluation status")
        if not non_empty_strings(item["evidence"]):
            raise ValueError("mandatory evaluation requires evidence")
        ids.add(item["evalId"])
    return values


def validate_findings(evidence: dict[str, Any], metric_ids: set[str]) -> list[dict[str, Any]]:
    findings = evidence.get("findings", [])
    if not isinstance(findings, list):
        raise ValueError("findings must be an array")
    issue_ids: set[str] = set()
    for finding in findings:
        if not isinstance(finding, dict) or not {"issueId", "severity", "primaryMetricId", "linkedMetricIds", "evidence"}.issubset(finding):
            raise ValueError("finding lacks required fields")
        issue_id = finding["issueId"]
        if not isinstance(issue_id, str) or issue_id in issue_ids:
            raise ValueError("duplicate issue ID")
        if finding["severity"] not in SEVERITIES:
            raise ValueError("invalid finding severity")
        if finding["primaryMetricId"] not in metric_ids:
            raise ValueError("finding primary metric is unknown")
        linked = finding["linkedMetricIds"]
        if not isinstance(linked, list) or any(item not in metric_ids for item in linked):
            raise ValueError("finding linked metrics are invalid")
        if not non_empty_strings(finding["evidence"]):
            raise ValueError("finding requires evidence")
        issue_ids.add(issue_id)
    return findings


def subjective_summary(values: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for group_id, item in values.items():
        ratings = item["ratings"]
        result[group_id] = {
            "count": len(ratings),
            "mean": rounded(statistics.fmean(ratings)),
            "median": rounded(statistics.median(ratings)),
            "min": min(ratings),
            "max": max(ratings),
            "lowConfidence": len(ratings) < 3,
            "highDisagreement": max(ratings) - min(ratings) >= 4,
            "evidence": item["evidence"],
        }
    return result


def calculate_groups(
    metrics: list[dict[str, Any]],
    group_weights: dict[str, int],
    items: dict[str, dict[str, Any]],
    subjective: dict[str, dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], float, float]:
    groups: dict[str, dict[str, Any]] = {}
    total_applicable = 0
    total_evaluated = 0
    for group_id, configured_weight in group_weights.items():
        group_metrics = [metric for metric in metrics if metric["groupId"] == group_id]
        applicable = [metric for metric in group_metrics if items[metric["id"]]["status"] != "not_applicable"]
        evaluated = [metric for metric in applicable if items[metric["id"]]["status"] == "evaluated"]
        applicable_weight = sum(metric["weight"] for metric in applicable)
        evaluated_weight = sum(metric["weight"] for metric in evaluated)
        total_applicable += applicable_weight
        total_evaluated += evaluated_weight
        structured_rate = (
            sum(metric["weight"] * items[metric["id"]]["rating"] / 5 for metric in evaluated) / evaluated_weight
            if evaluated_weight else 0.0
        )
        coverage = evaluated_weight / applicable_weight if applicable_weight else 1.0
        subjective_rate = None
        group_rate = structured_rate
        if group_id in EXPERIENCE_GROUPS:
            subjective_item = subjective.get(group_id)
            if subjective_item is not None:
                subjective_rate = statistics.fmean(subjective_item["ratings"]) / 10
                group_rate = structured_rate * 0.8 + subjective_rate * 0.2
            else:
                coverage = 0.0
                total_evaluated -= evaluated_weight
        groups[group_id] = {
            "weight": configured_weight,
            "applicableWeight": applicable_weight,
            "evaluatedWeight": evaluated_weight,
            "structuredRate": rounded(structured_rate),
            "subjectiveRate": rounded(subjective_rate) if subjective_rate is not None else None,
            "coverage": rounded(coverage),
            "score": rounded(configured_weight * group_rate),
        }
    coverage = total_evaluated / total_applicable if total_applicable else 1.0
    score = sum(group["score"] for group in groups.values())
    return groups, rounded(score), rounded(coverage)


def managed_p1(finding: dict[str, Any]) -> bool:
    return all(isinstance(finding.get(key), str) and finding[key].strip() for key in (
        "owner", "targetVersion", "fixedAcceptanceRule"
    ))


def decide(
    profile: dict[str, Any],
    groups: dict[str, dict[str, Any]],
    total: float,
    coverage: float,
    mandatory: list[dict[str, Any]],
    findings: list[dict[str, Any]],
) -> dict[str, Any]:
    stage = profile["stage"]
    threshold = profile["thresholds"].get(stage) if stage != "slice" else None
    reasons: list[str] = []
    statuses = {item["status"] for item in mandatory}
    p0 = [item for item in findings if item["severity"] == "P0"]
    p1 = [item for item in findings if item["severity"] == "P1"]

    if "blocked" in statuses:
        return {"stage": stage, "status": "blocked", "threshold": threshold, "reasons": ["mandatory evaluation is blocked"]}
    if p0:
        reasons.append("open P0 finding blocks acceptance")
    if "failed" in statuses:
        reasons.append("mandatory evaluation failed")
    if "manual_required" in statuses:
        reasons.append("mandatory evaluation still requires manual evidence")

    required_coverage = STAGE_COVERAGE.get(stage, 1.0)
    if coverage < required_coverage:
        reasons.append(f"evidence coverage is below the {stage} gate")
    if threshold is not None and total < threshold:
        reasons.append(f"score is below the {stage} threshold")

    minimums = {"general.core": 0.6, "general.stability": 0.7, "specialized": 0.6}
    for group_id, minimum in minimums.items():
        group = groups.get(group_id)
        if group and group["score"] / group["weight"] < minimum:
            reasons.append(f"{group_id} is below its critical minimum")
    if stage == "release":
        for group_id, group in groups.items():
            if group_id.startswith("general.") and group["score"] / group["weight"] < 0.5:
                reasons.append(f"{group_id} is below the Release minimum")

    if p1:
        if stage in {"rc", "release"}:
            reasons.append("open P1 finding blocks RC and Release")
        elif not all(managed_p1(item) for item in p1):
            reasons.append("open P1 finding lacks owner, target version, or fixed acceptance rule")

    if p0 or "failed" in statuses or (p1 and (stage in {"rc", "release"} or not all(managed_p1(item) for item in p1))):
        status = "failed"
    elif coverage < 0.7 or coverage < required_coverage or "manual_required" in statuses:
        status = "partial"
    elif threshold is not None and total < threshold:
        status = "failed"
    elif any("critical minimum" in reason or "Release minimum" in reason for reason in reasons):
        status = "failed"
    elif p1 and stage in {"alpha", "beta"}:
        status = "conditional"
        reasons.append("managed P1 finding remains open")
    else:
        status = "passed"
    return {"stage": stage, "status": status, "threshold": threshold, "reasons": reasons}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=pathlib.Path, required=True)
    parser.add_argument("--evidence", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    try:
        profile = load_json(args.profile, "profile")
        evidence = load_json(args.evidence, "evidence")
        metrics, group_weights = validate_profile(profile)
        if not isinstance(evidence, dict) or evidence.get("version") != 1:
            raise ValueError("evidence must be a version 1 object")
        if evidence.get("profileId") != profile["profileId"] or evidence.get("buildHash") != profile["buildHash"]:
            raise ValueError("evidence profile/build identity does not match the profile")
        item_results = validate_item_results(evidence, metrics)
        subjective_results = validate_subjective_results(evidence)
        mandatory = validate_mandatory(evidence)
        findings = validate_findings(evidence, {item["id"] for item in metrics})
        groups, total, coverage = calculate_groups(metrics, group_weights, item_results, subjective_results)
        subjective = subjective_summary(subjective_results)
        severity_counts = {severity: sum(item["severity"] == severity for item in findings) for severity in SEVERITIES}
        decision = decide(profile, groups, total, coverage, mandatory, findings)
        report = {
            "version": 1,
            "reportId": f"{profile['profileId']}-report",
            "profileId": profile["profileId"],
            "buildHash": profile["buildHash"],
            "gddRevision": profile["gddRevision"],
            "stage": profile["stage"],
            "genre": profile["genre"],
            "score": {
                "total": total,
                "formalTotal": None if coverage < 0.7 else total,
                "generalWeight": 80,
                "specializedWeight": 20,
                "groups": groups,
            },
            "coverage": coverage,
            "subjective": subjective,
            "confidence": {
                "lowConfidenceGroups": sorted(key for key, value in subjective.items() if value["lowConfidence"]),
                "highDisagreementGroups": sorted(key for key, value in subjective.items() if value["highDisagreement"]),
            },
            "itemResults": evidence["itemResults"],
            "mandatoryEvaluations": mandatory,
            "findings": findings,
            "severityCounts": severity_counts,
            "decision": decision,
            "rawResultReferences": {
                "metricIds": [item["metricId"] for item in evidence["itemResults"]],
                "subjectiveGroupIds": [item["groupId"] for item in evidence.get("subjectiveResults", [])],
                "mandatoryEvaluationIds": [item["evalId"] for item in mandatory],
            },
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "reportId": report["reportId"], "status": decision["status"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

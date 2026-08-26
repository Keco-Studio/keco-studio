#!/usr/bin/env python3
"""Validate external review evidence and score a Keco game evaluation."""

import argparse
import json
import pathlib
import sys
from typing import Any

from progress_log import append_event


EXPECTED = {
    "artStyle": {
        "styleConsistency": 20,
        "assetQualityAndFit": 15,
        "uiReadabilityAndLayout": 10,
        "visualFeedbackAndEmotion": 5,
    },
    "playerFun": {
        "coreLoopAppeal": 20,
        "meaningfulChoices": 15,
        "feedbackPacingAndGoals": 10,
        "motivationToContinue": 5,
    },
}
THRESHOLDS = {"alpha": 60, "beta": 70, "rc": 80, "release": 85}
SEVERITIES = ("P0", "P1", "P2", "P3")
MANDATORY_STATUSES = {"passed", "failed", "blocked", "manual_required"}


def append_progress(output: pathlib.Path, report: dict[str, Any]) -> None:
    append_event(
        output.parent, "score", "按 Claude 外部评价汇总分数",
        {"profileId": report["profileId"], "coverage": report["coverage"]},
        "score_game_evaluation.py", "artStyle 和 playerFun 各 50 分",
        {"status": report["claudeReview"]["status"], "total": report["claudeReview"]["total"]["score"]},
        "只有八项 Claude 评价贡献分数，人工字段保持空位",
        "validator 将重算维度、总分和风险门禁",
    )


def load_json(path: pathlib.Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def strings(value: Any, allow_empty: bool = False) -> bool:
    return isinstance(value, list) and (allow_empty or bool(value)) and all(
        isinstance(item, str) and item.strip() for item in value
    )


def text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_profile(profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if profile.get("version") != 1:
        raise ValueError("profile must be a version 1 object")
    if not all(text(profile.get(key)) for key in ("profileId", "gameId", "stage", "genre", "gddRevision", "buildHash", "lockedAt")):
        raise ValueError("profile identity fields must be non-empty strings")
    if profile.get("thresholds") != THRESHOLDS:
        raise ValueError("profile thresholds do not match the fixed stage gates")
    dimensions = profile.get("dimensions")
    if not isinstance(dimensions, dict) or list(dimensions) != list(EXPECTED):
        raise ValueError("profile must contain only artStyle and playerFun dimensions")
    metrics: dict[str, dict[str, Any]] = {}
    for dimension, expected_items in EXPECTED.items():
        configured = dimensions.get(dimension)
        if not isinstance(configured, dict) or configured.get("max") != 50:
            raise ValueError(f"{dimension} maximum must be 50")
        items = configured.get("items")
        if not isinstance(items, list) or len(items) != 4:
            raise ValueError(f"{dimension} must contain exactly four items")
        actual = {}
        for item in items:
            if not isinstance(item, dict) or item.get("dimension") != dimension:
                raise ValueError("profile item dimension is invalid")
            item_id = item.get("id")
            if not isinstance(item_id, str) or item_id in actual:
                raise ValueError("profile item IDs must be unique")
            actual[item_id] = item.get("max")
            metrics[f"{dimension}.{item_id}"] = item
        if actual != expected_items:
            raise ValueError(f"{dimension} item maxima do not match the fixed profile")
    return metrics


def pending_items() -> list[dict[str, Any]]:
    result = []
    for dimension, items in EXPECTED.items():
        for item_id in items:
            result.append({
                "dimension": dimension,
                "itemId": item_id,
                "status": "not_evaluated",
                "score": None,
                "reason": "An external Claude review was not supplied.",
                "evidence": [],
                "limitations": ["No validated external Claude review is available."],
                "nextIteration": "Supply a validated external Claude review JSON for this item.",
            })
    return result


def validate_claude_review(evidence: dict[str, Any]) -> list[dict[str, Any]]:
    review = evidence.get("claudeReview")
    if review is None:
        raw_items = pending_items()
    elif not isinstance(review, dict) or not isinstance(review.get("items"), list):
        raise ValueError("claudeReview.items must be an array")
    else:
        raw_items = review["items"]
    expected_keys = {f"{dimension}.{item_id}" for dimension, items in EXPECTED.items() for item_id in items}
    if len(raw_items) != len(expected_keys):
        raise ValueError("Claude review must contain exactly eight items")
    seen: set[str] = set()
    normalized = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            raise ValueError("Claude review item must be an object")
        dimension = raw.get("dimension")
        item_id = raw.get("itemId")
        key = f"{dimension}.{item_id}"
        if key not in expected_keys:
            raise ValueError("Claude review contains an unknown item")
        if key in seen:
            raise ValueError("Claude review contains a duplicate item")
        status = raw.get("status")
        score = raw.get("score")
        maximum = EXPECTED[dimension][item_id]
        if status not in {"evaluated", "not_evaluated"}:
            raise ValueError("Claude review item status is invalid")
        if not text(raw.get("reason")) or not strings(raw.get("limitations")) or not text(raw.get("nextIteration")):
            raise ValueError("Claude review item requires reason, limitations, and next iteration")
        item_evidence = raw.get("evidence")
        if status == "evaluated":
            if not isinstance(score, (int, float)) or isinstance(score, bool) or not 0 <= score <= maximum:
                raise ValueError(f"Claude review score exceeds the {maximum} maximum")
            if not strings(item_evidence):
                raise ValueError("evaluated Claude review item requires evidence")
        elif score is not None or not strings(item_evidence, allow_empty=True):
            raise ValueError("not_evaluated Claude review item must have null score and valid evidence references")
        normalized.append({
            "dimension": dimension,
            "itemId": item_id,
            "status": status,
            "score": score,
            "max": maximum,
            "reason": raw["reason"].strip(),
            "evidence": item_evidence,
            "limitations": raw["limitations"],
            "nextIteration": raw["nextIteration"].strip(),
        })
        seen.add(key)
    if seen != expected_keys:
        raise ValueError("Claude review must evaluate exactly the fixed eight items")
    return normalized


def validate_sources(evidence: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    sources = evidence.get("sourceReferences")
    required = {"gddRevision", "roadmapRevision", "sourceSnapshot", "godotBuildHash", "sliceEvalReports"}
    if not isinstance(sources, dict) or required - sources.keys():
        raise ValueError("sourceReferences must cite GDD, Roadmap, SourceSnapshot, Godot build, and Slice EvalReport")
    if sources["gddRevision"] != profile["gddRevision"] or sources["godotBuildHash"] != profile["buildHash"]:
        raise ValueError("source reference identity does not match the profile")
    if not text(sources["roadmapRevision"]) or not text(sources["sourceSnapshot"]) or not strings(sources["sliceEvalReports"]):
        raise ValueError("sourceReferences contain an empty identity")
    return sources


def validate_mandatory(evidence: dict[str, Any]) -> list[dict[str, Any]]:
    items = evidence.get("mandatoryEvaluations", [])
    if not isinstance(items, list):
        raise ValueError("mandatoryEvaluations must be an array")
    seen = set()
    for item in items:
        if not isinstance(item, dict) or not text(item.get("evalId")) or item.get("evalId") in seen:
            raise ValueError("mandatory evaluation IDs must be unique")
        if item.get("status") not in MANDATORY_STATUSES or not strings(item.get("evidence")):
            raise ValueError("mandatory evaluation status or evidence is invalid")
        seen.add(item["evalId"])
    return items


def validate_findings(evidence: dict[str, Any]) -> list[dict[str, Any]]:
    findings = evidence.get("findings", [])
    valid_metrics = {f"{dimension}.{item_id}" for dimension, items in EXPECTED.items() for item_id in items}
    if not isinstance(findings, list):
        raise ValueError("findings must be an array")
    seen = set()
    for finding in findings:
        required = {"issueId", "severity", "primaryMetricId", "linkedMetricIds", "evidence"}
        if not isinstance(finding, dict) or required - finding.keys():
            raise ValueError("finding lacks required fields")
        if not text(finding["issueId"]) or finding["issueId"] in seen:
            raise ValueError("duplicate issue ID")
        if finding["severity"] not in SEVERITIES or finding["primaryMetricId"] not in valid_metrics:
            raise ValueError("finding severity or primary metric is invalid")
        if not isinstance(finding["linkedMetricIds"], list) or any(item not in valid_metrics for item in finding["linkedMetricIds"]):
            raise ValueError("finding linked metrics are invalid")
        if not strings(finding["evidence"]):
            raise ValueError("finding requires evidence")
        seen.add(finding["issueId"])
    return findings


def managed_p1(finding: dict[str, Any]) -> bool:
    return all(text(finding.get(field)) for field in ("owner", "targetVersion", "fixedAcceptanceRule"))


def decision(profile: dict[str, Any], total: Any, coverage: float, mandatory: list[dict[str, Any]], findings: list[dict[str, Any]]) -> dict[str, Any]:
    stage = profile["stage"]
    threshold = THRESHOLDS.get(stage)
    statuses = {item["status"] for item in mandatory}
    p0 = [item for item in findings if item["severity"] == "P0"]
    p1 = [item for item in findings if item["severity"] == "P1"]
    reasons = []
    if p0:
        reasons.append("open P0 finding blocks acceptance")
    if "failed" in statuses:
        reasons.append("mandatory evaluation failed")
    if "blocked" in statuses:
        reasons.append("mandatory evaluation is blocked")
    if "manual_required" in statuses:
        reasons.append("mandatory evaluation still requires manual evidence")
    if coverage < 1:
        reasons.append("Claude review is incomplete")
    if total is not None and threshold is not None and total < threshold:
        reasons.append(f"Claude score is below the {stage} threshold")
    unmanaged_p1 = p1 and (stage in {"rc", "release"} or not all(managed_p1(item) for item in p1))
    if unmanaged_p1:
        reasons.append("open P1 finding blocks this stage or lacks a complete mitigation")

    if "blocked" in statuses:
        status = "blocked"
    elif p0 or "failed" in statuses or unmanaged_p1:
        status = "failed"
    elif total is None or "manual_required" in statuses:
        status = "partial"
    elif threshold is not None and total < threshold:
        status = "failed"
    elif p1:
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
        validate_profile(profile)
        evidence = load_json(args.evidence, "evidence")
        if evidence.get("version") != 1:
            raise ValueError("evidence must be a version 1 object")
        if evidence.get("profileId") != profile["profileId"] or evidence.get("buildHash") != profile["buildHash"] or evidence.get("gddRevision") != profile["gddRevision"]:
            raise ValueError("evidence profile, build, or GDD identity does not match the profile")
        sources = validate_sources(evidence, profile)
        items = validate_claude_review(evidence)
        mandatory = validate_mandatory(evidence)
        findings = validate_findings(evidence)
        dimensions = {}
        for dimension in EXPECTED:
            dimension_items = [item for item in items if item["dimension"] == dimension]
            complete = all(item["status"] == "evaluated" for item in dimension_items)
            dimensions[dimension] = {
                "score": sum(item["score"] for item in dimension_items) if complete else None,
                "max": 50,
                "items": dimension_items,
            }
        complete = all(item["status"] == "evaluated" for item in items)
        total = sum(dimensions[name]["score"] for name in EXPECTED) if complete else None
        coverage = sum(item["status"] == "evaluated" for item in items) / len(items)
        severity_counts = {severity: sum(item["severity"] == severity for item in findings) for severity in SEVERITIES}
        result_decision = decision(profile, total, coverage, mandatory, findings)
        report = {
            "version": 1,
            "reportId": f"{profile['profileId']}-report",
            "profileId": profile["profileId"],
            "buildHash": profile["buildHash"],
            "gddRevision": profile["gddRevision"],
            "stage": profile["stage"],
            "genre": profile["genre"],
            "sourceReferences": sources,
            "claudeReview": {
                "status": "complete" if complete else "pending",
                "dimensions": dimensions,
                "total": {"score": total, "max": 100},
            },
            "humanReview": {
                "artStyle": {"score": None, "max": 50, "comment": None, "nextIteration": None},
                "playerFun": {"score": None, "max": 50, "comment": None, "nextIteration": None},
                "total": {"score": None, "max": 100},
            },
            "coverage": coverage,
            "technicalEvidence": evidence.get("technicalEvidence", {}),
            "mandatoryEvaluations": mandatory,
            "findings": findings,
            "severityCounts": severity_counts,
            "decision": result_decision,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        append_progress(args.output, report)
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "reportId": report["reportId"], "status": result_decision["status"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

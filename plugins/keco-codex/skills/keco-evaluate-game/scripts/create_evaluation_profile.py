#!/usr/bin/env python3
"""Create the fixed Keco art-style and player-fun evaluation profile."""

import argparse
import json
import pathlib
import re
import sys
from typing import Any

from execution_cache import execution_identity, reusable_event, sha256_file
from progress_log import append_event


THRESHOLDS = {"alpha": 60, "beta": 70, "rc": 80, "release": 85}
STAGES = {"slice", *THRESHOLDS}


def item(
    dimension: str,
    item_id: str,
    name: str,
    maximum: int,
    zero: str,
    full: str,
    evidence: list[str],
) -> dict[str, Any]:
    return {
        "id": item_id,
        "dimension": dimension,
        "name": name,
        "max": maximum,
        "anchors": {"zero": zero, "full": full},
        "requiredEvidence": evidence,
    }


DIMENSIONS = {
    "artStyle": {
        "max": 50,
        "items": [
            item("artStyle", "styleConsistency", "Style consistency", 20,
                 "Visual rules conflict across inspected states.",
                 "The inspected states consistently follow a clear visual direction.",
                 ["gameplay captures", "GDD art direction"]),
            item("artStyle", "assetQualityAndFit", "Asset quality and fit", 15,
                 "Assets are visibly unfinished or conflict with the intended experience.",
                 "Assets are polished and fit the intended experience and visual direction.",
                 ["asset samples", "runtime captures"]),
            item("artStyle", "uiReadabilityAndLayout", "UI readability and layout", 10,
                 "Critical information is unreadable or structurally unclear.",
                 "Critical information remains readable with a coherent hierarchy and layout.",
                 ["HUD captures", "menu captures"]),
            item("artStyle", "visualFeedbackAndEmotion", "Visual feedback and emotion", 5,
                 "Visual feedback does not communicate actions, state, or intended emotion.",
                 "Visual feedback clearly reinforces actions, state, and intended emotion.",
                 ["gameplay captures", "Slice EvalReport"]),
        ],
    },
    "playerFun": {
        "max": 50,
        "items": [
            item("playerFun", "coreLoopAppeal", "Core loop appeal", 20,
                 "Implemented loop evidence provides no credible reason to repeat interaction.",
                 "Implemented loop evidence supports a strong reason to repeat interaction.",
                 ["playable build evidence", "Slice EvalReport", "GDD core loop"]),
            item("playerFun", "meaningfulChoices", "Meaningful choices", 15,
                 "Available choices do not materially change approach or outcome.",
                 "Available choices produce clear and materially different approaches or outcomes.",
                 ["choice outcomes", "gameplay implementation"]),
            item("playerFun", "feedbackPacingAndGoals", "Feedback, pacing, and goals", 10,
                 "Goals, pacing, and response feedback do not sustain understandable interaction.",
                 "Goals, pacing, and response feedback form a legible and engaging progression.",
                 ["play sequence evidence", "goal and reward captures"]),
            item("playerFun", "motivationToContinue", "Motivation to continue", 5,
                 "Available evidence presents no concrete reason to continue.",
                 "Available evidence presents concrete and escalating reasons to continue.",
                 ["progression evidence", "player-session evidence when available"]),
        ],
    },
}


EVALUATOR_VERSION = "profile-v1"


def append_progress(output: pathlib.Path, profile: dict[str, Any], operation_key: str, input_hash: str) -> None:
    append_event(
        output.parent, "profile", "\u9501\u5b9a\u8bc4\u4ef7\u8303\u56f4\u548c\u56fa\u5b9a\u8bc4\u5206\u9879",
        {"gameId": profile["gameId"], "stage": profile["stage"], "genre": profile["genre"], "gddRevision": profile["gddRevision"], "buildHash": profile["buildHash"]},
        "create_evaluation_profile.py", "\u4e24\u7ef4\u516b\u9879\u56fa\u5b9a profile",
        {"profileId": profile["profileId"], "dimensions": list(profile["dimensions"])},
        "\u8bc4\u5206\u6743\u91cd\u5df2\u9501\u5b9a\uff0cgenre \u53ea\u4fdd\u7559\u4e3a\u8eab\u4efd\u5143\u6570\u636e",
        "\u540e\u7eed\u8bc1\u636e\u53ea\u80fd\u6309\u8fd9\u516b\u4e2a\u5b50\u9879\u63d0\u4ea4",
        operation_key, input_hash, sha256_file(output),
    )


def non_empty(value: str, label: str) -> str:
    result = value.strip()
    if not result:
        raise ValueError(f"{label} must be non-empty")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-id", required=True)
    parser.add_argument("--stage", required=True, choices=sorted(STAGES))
    parser.add_argument("--genre", required=True)
    parser.add_argument("--gdd-revision", required=True)
    parser.add_argument("--build-hash", required=True)
    parser.add_argument("--locked-at", required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    try:
        cache_inputs = {
            "gameId": args.game_id, "stage": args.stage, "genre": args.genre,
            "gddRevision": args.gdd_revision, "buildHash": args.build_hash,
            "lockedAt": args.locked_at,
        }
        operation_key, input_hash = execution_identity("profile", EVALUATOR_VERSION, cache_inputs)
        reused = reusable_event(args.output.parent, operation_key, input_hash, args.output)
        if reused is not None:
            print(json.dumps({"ok": True, "outcome": "reused", "operationKey": operation_key}, sort_keys=True))
            return 0
        game_id = non_empty(args.game_id, "gameId")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", game_id):
            raise ValueError("gameId contains unsupported characters")
        profile = {
            "version": 1,
            "profileId": f"{game_id}-{args.stage}-v1",
            "gameId": game_id,
            "stage": args.stage,
            "genre": non_empty(args.genre, "genre"),
            "gddRevision": non_empty(args.gdd_revision, "gddRevision"),
            "buildHash": non_empty(args.build_hash, "buildHash"),
            "lockedAt": non_empty(args.locked_at, "lockedAt"),
            "thresholds": THRESHOLDS,
            "dimensions": DIMENSIONS,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(profile, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        append_progress(args.output, profile, operation_key, input_hash)
    except (OSError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "outcome": "created", "operationKey": operation_key, "profileId": profile["profileId"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

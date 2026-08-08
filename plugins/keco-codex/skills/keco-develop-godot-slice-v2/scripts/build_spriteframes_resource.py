#!/usr/bin/env python3
"""Build a deterministic Godot 4 SpriteFrames resource from verified sheets."""

from __future__ import annotations

import argparse
import json
import os
import re
import struct
import tempfile
from pathlib import Path


NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if len(data) < 24 or data[:8] != PNG_SIGNATURE or data[12:16] != b"IHDR":
        raise ValueError(f"invalid PNG header: {path}")
    width, height = struct.unpack(">II", data[16:24])
    if not width or not height:
        raise ValueError(f"PNG dimensions must be positive: {path}")
    return width, height


def godot_string(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def parse_manifest(path: Path) -> tuple[str, list[dict]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid manifest: {exc}") from exc
    if data.get("version") != 1 or not isinstance(data.get("animations"), list) or not data["animations"]:
        raise ValueError("manifest requires version 1 and a non-empty animations array")
    resource_path = data.get("resourcePath")
    if not isinstance(resource_path, str) or not resource_path.startswith("res://") or ".." in Path(resource_path).parts:
        raise ValueError("resourcePath must be a safe res:// path")
    seen: set[str] = set()
    for animation in data["animations"]:
        required = ("name", "sheetPath", "sheetFile", "frameWidth", "frameHeight", "frameCount", "fps", "loop")
        if not all(key in animation for key in required):
            raise ValueError("each animation requires name, sheetPath, sheetFile, frameWidth, frameHeight, frameCount, fps, and loop")
        name = animation["name"]
        if not isinstance(name, str) or not NAME_RE.fullmatch(name) or name in seen:
            raise ValueError(f"animation names must be unique and use letters, numbers, _ or -: {name!r}")
        seen.add(name)
        sheet_path = animation["sheetPath"]
        if not isinstance(sheet_path, str) or not sheet_path.startswith("res://") or ".." in Path(sheet_path).parts:
            raise ValueError(f"sheetPath must be a safe res:// path: {sheet_path!r}")
        if any(not isinstance(animation[key], int) or animation[key] <= 0 for key in ("frameWidth", "frameHeight", "frameCount")):
            raise ValueError(f"frame dimensions and count must be positive integers: {name}")
        if not isinstance(animation["fps"], (int, float)) or animation["fps"] <= 0:
            raise ValueError(f"fps must be positive: {name}")
        sheet_file = Path(animation["sheetFile"])
        if not sheet_file.is_file():
            raise ValueError(f"sheetFile does not exist: {sheet_file}")
        width, height = png_dimensions(sheet_file)
        expected = (animation["frameWidth"] * animation["frameCount"], animation["frameHeight"])
        if (width, height) != expected:
            raise ValueError(f"frame geometry mismatch for {name}: expected {expected[0]}x{expected[1]}, got {width}x{height}")
    return resource_path, data["animations"]


def build_resource(resource_path: str, animations: list[dict]) -> str:
    sheet_ids: dict[str, str] = {}
    for index, animation in enumerate(animations):
        sheet_ids[animation["name"]] = f"sheet_{index}"
    atlas_count = sum(animation["frameCount"] for animation in animations)
    lines = [f"[gd_resource type=\"SpriteFrames\" load_steps={len(animations) + atlas_count + 1} format=3]", ""]
    for animation in animations:
        name = animation["name"]
        lines.append(f"[ext_resource type=\"Texture2D\" path=\"{godot_string(animation['sheetPath'])}\" id=\"{sheet_ids[name]}\"]")
    lines.append("")
    for animation in animations:
        name = animation["name"]
        for frame in range(animation["frameCount"]):
            atlas_id = f"AtlasTexture_{name}_{frame}"
            lines.extend([
                f"[sub_resource type=\"AtlasTexture\" id=\"{atlas_id}\"]",
                f"atlas = ExtResource(\"{sheet_ids[name]}\")",
                f"region = Rect2({frame * animation['frameWidth']}, 0, {animation['frameWidth']}, {animation['frameHeight']})",
                "",
            ])
    lines.append("[resource]")
    animation_values = []
    for animation in animations:
        name = animation["name"]
        frames = ", ".join(
            f'{{"duration": 1.0, "texture": SubResource("AtlasTexture_{name}_{frame}")}}'
            for frame in range(animation["frameCount"])
        )
        speed = f"{animation['fps']:g}"
        animation_values.append(
            f'{{"frames": [{frames}], "loop": {str(bool(animation["loop"])).lower()}, "name": &"{godot_string(name)}", "speed": {speed}}}'
        )
    lines.append("animations = [" + ", ".join(animation_values) + "]")
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        resource_path, animations = parse_manifest(args.manifest)
        content = build_resource(resource_path, animations)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=args.output.parent, delete=False) as handle:
            handle.write(content)
            temporary = Path(handle.name)
        os.replace(temporary, args.output)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps({"ok": True, "output": str(args.output), "animationCount": len(animations)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

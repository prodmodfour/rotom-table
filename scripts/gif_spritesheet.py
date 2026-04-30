"""GIF-to-PNG-spritesheet conversion shared by sprite downloaders.

Pillow's GIF plugin applies the frame disposal/compositing rules as frames are
seeked. We intentionally capture ``image.convert('RGBA')`` after each seek so
spritesheet frames are full logical-screen frames matching what a browser would
show for an animated ``<img>``, not raw partial GIF rectangles.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from PIL import Image


def spritesheet_public_path(local_path: str) -> str:
    """Return the public/ relative PNG spritesheet path for a GIF asset path."""
    source = Path(local_path)
    parts = source.parts
    if parts and parts[0] == "sprites":
        source = Path(*parts[1:])
    return (Path("spritesheets") / source).with_suffix(".png").as_posix()


def convert_gif_to_spritesheet(
    gif_path: Path,
    public_root: Path,
    local_path: str,
) -> dict[str, Any]:
    """Convert a GIF into a PNG spritesheet and return manifest metadata."""
    with Image.open(gif_path) as image:
        frame_width, frame_height = image.size
        frame_count = int(getattr(image, "n_frames", 1))
        frames = []
        durations_ms: list[int] = []

        for index in range(frame_count):
            image.seek(index)
            # Force loading at this seek position so Pillow applies GIF
            # disposal/compositing before conversion to a full RGBA frame.
            image.load()
            duration = image.info.get("duration")
            durations_ms.append(int(duration) if duration is not None else 100)
            frames.append(image.convert("RGBA").copy())

    if not frames:
        raise RuntimeError(f"No frames decoded from {gif_path}")

    columns = max(1, math.ceil(math.sqrt(len(frames))))
    rows = max(1, math.ceil(len(frames) / columns))
    sheet = Image.new("RGBA", (columns * frame_width, rows * frame_height), (0, 0, 0, 0))

    for index, frame in enumerate(frames):
        column = index % columns
        row = index // columns
        sheet.alpha_composite(frame, (column * frame_width, row * frame_height))

    sheet_path = spritesheet_public_path(local_path)
    output_path = public_root / sheet_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path, format="PNG")

    return {
        "spritesheet_path": sheet_path,
        "frame_width": frame_width,
        "frame_height": frame_height,
        "frames": len(frames),
        "columns": columns,
        "rows": rows,
        "durations_ms": durations_ms,
        "total_duration_ms": sum(durations_ms),
    }


def with_animation_metadata(entry: dict[str, Any], public_root: Path) -> dict[str, Any]:
    """Return a manifest entry with animation metadata for GIF assets."""
    updated = dict(entry)
    local_path = str(updated.get("local_path", ""))
    if not local_path.lower().endswith(".gif"):
        updated.pop("animation", None)
        return updated

    gif_path = public_root / local_path
    if not gif_path.exists():
        raise FileNotFoundError(f"GIF listed in manifest does not exist: {gif_path}")

    updated["animation"] = convert_gif_to_spritesheet(gif_path, public_root, local_path)
    return updated

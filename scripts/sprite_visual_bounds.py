"""Extract source-canvas visual bounds metadata from sprite images.

The returned coordinates are always measured in the source image's canvas pixels.
For animated GIFs, bounds are computed from the union of every fully composited
logical-screen frame so animation metadata remains stable regardless of frame
optimization rectangles.

``floating`` is a conservative generation-time heuristic: a sprite is considered
floating when the alpha bounding box leaves at least
``FLOATING_BOTTOM_GAP_THRESHOLD_PX`` fully transparent pixels below it. The named
threshold filters tiny encoder or antialiasing padding while keeping the runtime
metadata format independent from CSS/world scaling.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image

# Minimum transparent source-canvas pixels below the visible alpha bounds needed
# to classify a sprite as visually floating/hovering.
FLOATING_BOTTOM_GAP_THRESHOLD_PX = 4

AlphaBoundingBox = tuple[int, int, int, int]


@dataclass(frozen=True)
class SpriteVisualBounds:
    """Source-canvas visual bounds ready to serialize into sprite manifests."""

    canvas_width: int
    canvas_height: int
    left: int
    top: int
    width: int
    height: int
    floating: bool

    def to_manifest_record(self) -> dict[str, int | bool]:
        """Return the snake_case record shape used by generated JSON manifests."""
        return {
            "canvas_width": self.canvas_width,
            "canvas_height": self.canvas_height,
            "left": self.left,
            "top": self.top,
            "width": self.width,
            "height": self.height,
            "floating": self.floating,
        }


def extract_sprite_visual_bounds(sprite_path: str | Path) -> SpriteVisualBounds:
    """Extract stable visual-bounds metadata for a static image or animated GIF."""
    path = Path(sprite_path)
    with Image.open(path) as image:
        canvas_size = image.size
        if _is_animated_gif(image):
            return _bounds_from_frames(canvas_size, _iter_composited_rgba_frames(image))

        return _bounds_from_frames(canvas_size, [image.convert("RGBA")])


def extract_sprite_visual_bounds_record(sprite_path: str | Path) -> dict[str, int | bool]:
    """Extract visual bounds and return the manifest JSON record shape."""
    return extract_sprite_visual_bounds(sprite_path).to_manifest_record()


def _is_animated_gif(image: Image.Image) -> bool:
    return image.format == "GIF" and int(getattr(image, "n_frames", 1)) > 1


def _iter_composited_rgba_frames(image: Image.Image) -> Iterable[Image.Image]:
    """Yield full logical-screen RGBA frames after GIF disposal/compositing."""
    frame_count = int(getattr(image, "n_frames", 1))
    for index in range(frame_count):
        image.seek(index)
        # Loading at this seek position lets Pillow apply GIF disposal and
        # compositing before conversion, matching scripts/gif_spritesheet.py.
        image.load()
        yield image.convert("RGBA").copy()


def _bounds_from_frames(
    canvas_size: tuple[int, int],
    frames: Iterable[Image.Image],
) -> SpriteVisualBounds:
    canvas_width, canvas_height = canvas_size
    alpha_bounds = [_alpha_bounds(frame) for frame in frames]
    union = _union_bounds(bound for bound in alpha_bounds if bound is not None)

    if union is None:
        return SpriteVisualBounds(
            canvas_width=canvas_width,
            canvas_height=canvas_height,
            left=0,
            top=0,
            width=canvas_width,
            height=canvas_height,
            floating=False,
        )

    left, top, right, bottom = union
    bottom_gap = max(0, canvas_height - bottom)
    return SpriteVisualBounds(
        canvas_width=canvas_width,
        canvas_height=canvas_height,
        left=left,
        top=top,
        width=max(0, right - left),
        height=max(0, bottom - top),
        floating=bottom_gap >= FLOATING_BOTTOM_GAP_THRESHOLD_PX,
    )


def _alpha_bounds(frame: Image.Image) -> AlphaBoundingBox | None:
    rgba = frame if frame.mode == "RGBA" else frame.convert("RGBA")
    return rgba.getchannel("A").getbbox()


def _union_bounds(bounds: Iterable[AlphaBoundingBox]) -> AlphaBoundingBox | None:
    iterator = iter(bounds)
    try:
        left, top, right, bottom = next(iterator)
    except StopIteration:
        return None

    for current_left, current_top, current_right, current_bottom in iterator:
        left = min(left, current_left)
        top = min(top, current_top)
        right = max(right, current_right)
        bottom = max(bottom, current_bottom)

    return left, top, right, bottom

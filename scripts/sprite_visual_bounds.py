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

Manual overrides are applied at manifest-generation time so the Nuxt runtime can
consume final metadata without knowing which species required visual cleanup.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

# Minimum transparent source-canvas pixels below the visible alpha bounds needed
# to classify a sprite as visually floating/hovering.
FLOATING_BOTTOM_GAP_THRESHOLD_PX = 4

# Override files use the same snake_case field names as generated manifests.
VISUAL_BOUNDS_OVERRIDE_FIELDS = frozenset(
    {
        "canvas_width",
        "canvas_height",
        "left",
        "top",
        "width",
        "height",
        "floating",
    }
)
VISUAL_BOUNDS_POSITIVE_INTEGER_FIELDS = frozenset(
    {"canvas_width", "canvas_height", "width", "height"}
)
VISUAL_BOUNDS_VIEW_KEYS = frozenset({"front", "back"})
DEFAULT_VISUAL_BOUNDS_OVERRIDES_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "spriteVisualBoundsOverrides.json"
)

AlphaBoundingBox = tuple[int, int, int, int]
SpriteVisualBoundsRecord = dict[str, int | bool]
SpriteVisualBoundsOverrideMap = Mapping[str, Any]


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

    def to_manifest_record(self) -> SpriteVisualBoundsRecord:
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


def extract_sprite_visual_bounds_record(sprite_path: str | Path) -> SpriteVisualBoundsRecord:
    """Extract visual bounds and return the manifest JSON record shape."""
    return extract_sprite_visual_bounds(sprite_path).to_manifest_record()


def load_sprite_visual_bounds_overrides(
    overrides_path: str | Path = DEFAULT_VISUAL_BOUNDS_OVERRIDES_PATH,
) -> dict[str, Any]:
    """Load optional per-species visual-bounds overrides.

    Missing files behave as an empty override map. A present file must be a JSON
    object keyed by exact species name, with an optional ``$schema`` property.
    """
    path = Path(overrides_path)
    if not path.exists():
        return {}

    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return {}

    raw = json.loads(text)
    if not isinstance(raw, dict):
        raise ValueError(f"Visual-bounds overrides must be a JSON object: {path}")

    overrides: dict[str, Any] = {}
    for species, override in raw.items():
        if species == "$schema":
            continue
        if not species:
            raise ValueError(f"Visual-bounds override species keys must be non-empty: {path}")
        if not isinstance(override, Mapping):
            raise ValueError(f"Visual-bounds override for {species!r} must be an object")

        _validate_species_override(species, override)
        overrides[species] = override

    return overrides


def apply_sprite_visual_bounds_override(
    visual_bounds: Mapping[str, Any],
    species: str,
    view: str,
    overrides: SpriteVisualBoundsOverrideMap | None = None,
) -> SpriteVisualBoundsRecord:
    """Return visual bounds after applying the matching species/view override."""
    merged = dict(visual_bounds)
    selected_override = _select_visual_bounds_override(species, view, overrides)
    if selected_override:
        merged.update(selected_override)

    return _validated_visual_bounds_record(merged, species, view)


def _select_visual_bounds_override(
    species: str,
    view: str,
    overrides: SpriteVisualBoundsOverrideMap | None,
) -> dict[str, Any]:
    if overrides is None:
        overrides = load_sprite_visual_bounds_overrides()

    species_override = overrides.get(species)
    if species_override is None:
        return {}
    if not isinstance(species_override, Mapping):
        raise ValueError(f"Visual-bounds override for {species!r} must be an object")

    selected: dict[str, Any] = {
        field: species_override[field]
        for field in VISUAL_BOUNDS_OVERRIDE_FIELDS
        if field in species_override
    }

    view_override = species_override.get(view)
    if view_override is not None:
        if not isinstance(view_override, Mapping):
            raise ValueError(
                f"Visual-bounds override for {species!r} {view!r} must be an object"
            )
        selected.update(view_override)

    if selected:
        _validate_override_fields(f"{species!r} {view!r}", selected)

    return selected


def _validate_species_override(species: str, override: Mapping[str, Any]) -> None:
    common_override = {
        field: override[field]
        for field in VISUAL_BOUNDS_OVERRIDE_FIELDS
        if field in override
    }
    view_keys = {key for key in VISUAL_BOUNDS_VIEW_KEYS if key in override}
    unknown_fields = set(override) - VISUAL_BOUNDS_OVERRIDE_FIELDS - VISUAL_BOUNDS_VIEW_KEYS
    if unknown_fields:
        fields = ", ".join(sorted(unknown_fields))
        raise ValueError(f"Unknown visual-bounds override fields for {species!r}: {fields}")

    if common_override:
        _validate_override_fields(f"{species!r}", common_override)

    for view in sorted(view_keys):
        view_override = override[view]
        if not isinstance(view_override, Mapping):
            raise ValueError(
                f"Visual-bounds override for {species!r} {view!r} must be an object"
            )
        _validate_override_fields(f"{species!r} {view!r}", view_override)

    if not common_override and not view_keys:
        raise ValueError(
            f"Visual-bounds override for {species!r} must set a bounds field, "
            "front override, or back override"
        )


def _validate_override_fields(context: str, override: Mapping[str, Any]) -> None:
    if not override:
        raise ValueError(f"Visual-bounds override for {context} must not be empty")

    unknown_fields = set(override) - VISUAL_BOUNDS_OVERRIDE_FIELDS
    if unknown_fields:
        fields = ", ".join(sorted(unknown_fields))
        raise ValueError(f"Unknown visual-bounds override fields for {context}: {fields}")

    for field, value in override.items():
        if field == "floating":
            if type(value) is not bool:
                raise ValueError(f"Visual-bounds override {context}.{field} must be boolean")
            continue

        if type(value) is not int:
            raise ValueError(f"Visual-bounds override {context}.{field} must be an integer")

        minimum = 1 if field in VISUAL_BOUNDS_POSITIVE_INTEGER_FIELDS else 0
        if value < minimum:
            raise ValueError(
                f"Visual-bounds override {context}.{field} must be >= {minimum}"
            )


def _validated_visual_bounds_record(
    record: Mapping[str, Any],
    species: str,
    view: str,
) -> SpriteVisualBoundsRecord:
    missing_fields = VISUAL_BOUNDS_OVERRIDE_FIELDS - set(record)
    if missing_fields:
        fields = ", ".join(sorted(missing_fields))
        raise ValueError(f"Visual-bounds record for {species!r} {view!r} is missing: {fields}")

    canvas_width = _read_visual_bounds_int(record, "canvas_width", species, view, 1)
    canvas_height = _read_visual_bounds_int(record, "canvas_height", species, view, 1)
    left = _read_visual_bounds_int(record, "left", species, view, 0)
    top = _read_visual_bounds_int(record, "top", species, view, 0)
    width = _read_visual_bounds_int(record, "width", species, view, 1)
    height = _read_visual_bounds_int(record, "height", species, view, 1)
    floating = record["floating"]
    if type(floating) is not bool:
        raise ValueError(f"Visual-bounds record for {species!r} {view!r} has non-boolean floating")

    if left + width > canvas_width:
        raise ValueError(f"Visual-bounds record for {species!r} {view!r} exceeds canvas width")
    if top + height > canvas_height:
        raise ValueError(f"Visual-bounds record for {species!r} {view!r} exceeds canvas height")

    return {
        "canvas_width": canvas_width,
        "canvas_height": canvas_height,
        "left": left,
        "top": top,
        "width": width,
        "height": height,
        "floating": floating,
    }


def _read_visual_bounds_int(
    record: Mapping[str, Any],
    field: str,
    species: str,
    view: str,
    minimum: int,
) -> int:
    value = record[field]
    if type(value) is not int or value < minimum:
        raise ValueError(
            f"Visual-bounds record for {species!r} {view!r} has invalid {field}; "
            f"expected integer >= {minimum}"
        )
    return value


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

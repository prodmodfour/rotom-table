#!/usr/bin/env python3
"""Generate static profile images from every front-facing sprite.

The tabletop uses animated sprites in-scene, but initiative portraits should be
stable. This script builds square PNG profile assets from the first composited
frame of each Pokémon front sprite and every trainer front sprite.
"""

from __future__ import annotations

import argparse
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_ROOT = REPO_ROOT / "public"
POKEMON_MANIFEST_PATH = REPO_ROOT / "data" / "pokemonSpriteManifest.json"
TRAINER_MANIFEST_PATH = REPO_ROOT / "trainer_sizes" / "sprite_manifest.json"
TRAINER_SPRITE_ROOT = REPO_ROOT / "trainer_sizes"
PROFILE_ROOT = PUBLIC_ROOT / "profile-sprites"
POKEMON_PROFILE_DIR = PROFILE_ROOT / "pokemon"
TRAINER_PROFILE_DIR = PROFILE_ROOT / "trainers"
PROFILE_WIDTH = 192
PROFILE_HEIGHT = 72
PROFILE_PADDING = 4
PROFILE_VISIBLE_HEIGHT_RATIO = 0.38
PROFILE_VERTICAL_FOCUS = 0.18


@dataclass(frozen=True)
class ProfileSource:
    slug: str
    source_path: Path
    output_path: Path


def load_json(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def first_composited_frame(path: Path) -> Image.Image:
    """Return the first display frame of a static image or animated GIF."""
    with Image.open(path) as image:
        image.seek(0)
        image.load()
        return image.convert("RGBA")


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    bbox = image.getbbox()
    if bbox is None:
        return (0, 0, image.width, image.height)
    return bbox


def render_profile_image(source_path: Path, output_path: Path) -> None:
    frame = first_composited_frame(source_path)
    crop = frame.crop(alpha_bbox(frame))

    available_width = PROFILE_WIDTH - (PROFILE_PADDING * 2)
    available_height = PROFILE_HEIGHT - (PROFILE_PADDING * 2)
    # Rectangular profile panels should read like upper-body portraits, not
    # miniatures. Fit the full width, but only the upper slice of the source
    # height so tall sprites can crop from below inside the banner.
    scale = min(
        available_width / max(crop.width, 1),
        available_height / max(crop.height * PROFILE_VISIBLE_HEIGHT_RATIO, 1),
    )
    resized_size = (
        max(1, round(crop.width * scale)),
        max(1, round(crop.height * scale)),
    )
    resized = crop.resize(resized_size, Image.Resampling.NEAREST)

    canvas = Image.new("RGBA", (PROFILE_WIDTH, PROFILE_HEIGHT), (0, 0, 0, 0))
    offset = (
        (PROFILE_WIDTH - resized.width) // 2,
        round((PROFILE_HEIGHT - resized.height) * PROFILE_VERTICAL_FOCUS),
    )
    canvas.paste(resized, offset, resized)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path, format="PNG", optimize=True)


def pokemon_profile_sources() -> Iterable[ProfileSource]:
    for entry in load_json(POKEMON_MANIFEST_PATH):
        slug = entry.get("slug")
        local_path = entry.get("local_path")
        if not slug or not local_path:
            continue
        yield ProfileSource(
            slug=slug,
            source_path=PUBLIC_ROOT / local_path,
            output_path=POKEMON_PROFILE_DIR / f"{slug}.png",
        )


def trainer_profile_sources() -> Iterable[ProfileSource]:
    for entry in load_json(TRAINER_MANIFEST_PATH):
        slug = entry.get("slug")
        local_path = entry.get("local_path")
        if not slug or not local_path:
            continue
        yield ProfileSource(
            slug=slug,
            source_path=TRAINER_SPRITE_ROOT / local_path,
            output_path=TRAINER_PROFILE_DIR / f"{slug}.png",
        )


def generate_profiles(sources: Iterable[ProfileSource]) -> tuple[int, list[str]]:
    written = 0
    errors: list[str] = []
    for source in sources:
        if not source.source_path.exists():
            errors.append(f"missing source for {source.slug}: {source.source_path}")
            continue
        try:
            render_profile_image(source.source_path, source.output_path)
            written += 1
        except Exception as exc:  # noqa: BLE001 - report all failures after the batch.
            errors.append(f"failed {source.slug}: {exc}")
    return written, errors


def reset_output_dirs() -> None:
    for path in (POKEMON_PROFILE_DIR, TRAINER_PROFILE_DIR):
        if path.exists():
            shutil.rmtree(path)
        path.mkdir(parents=True, exist_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--keep-existing",
        action="store_true",
        help="do not clear existing generated profile assets before writing",
    )
    args = parser.parse_args()

    if not args.keep_existing:
        reset_output_dirs()

    pokemon_count, pokemon_errors = generate_profiles(pokemon_profile_sources())
    trainer_count, trainer_errors = generate_profiles(trainer_profile_sources())
    errors = [*pokemon_errors, *trainer_errors]

    print(f"Generated {pokemon_count} Pokémon profile sprites in {POKEMON_PROFILE_DIR}")
    print(f"Generated {trainer_count} trainer profile sprites in {TRAINER_PROFILE_DIR}")
    if errors:
        print("\n".join(errors[:50]))
        if len(errors) > 50:
            print(f"...and {len(errors) - 50} more errors")
        raise SystemExit(1)


if __name__ == "__main__":
    main()

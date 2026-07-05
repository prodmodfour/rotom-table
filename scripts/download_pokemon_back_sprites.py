#!/usr/bin/env python3
"""Download back sprite assets corresponding to data/pokemonSpriteManifest.json.

Pokémon Showdown does not provide a back-facing HOME/model directory, so
front-only HOME-centered model fallbacks are intentionally omitted from the back
manifest. The tabletop will mirror those front sprites instead of offering a
separate turn asset.
"""

from __future__ import annotations

import argparse
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests

from gif_spritesheet import with_animation_metadata
from sprite_visual_bounds import (
    apply_sprite_visual_bounds_override,
    extract_sprite_visual_bounds_record,
    load_sprite_visual_bounds_overrides,
)

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
PUBLIC_ROOT = REPO_ROOT / 'public'
FRONT_MANIFEST_PATH = REPO_ROOT / 'data' / 'pokemonSpriteManifest.json'
BACK_MANIFEST_PATH = REPO_ROOT / 'data' / 'pokemonBackSpriteManifest.json'
VISUAL_BOUNDS_OVERRIDES_PATH = REPO_ROOT / 'data' / 'spriteVisualBoundsOverrides.json'
MAX_WORKERS = 16
USER_AGENT = 'rotom-table back sprite downloader'

SHOWDOWN_BASE_URL = 'https://play.pokemonshowdown.com/sprites'
SHOWDOWN_BACK_INDEXES: dict[tuple[str, str], str] = {
    ('gen5ani-back', 'gif'): f'{SHOWDOWN_BASE_URL}/gen5ani-back/?sort=name',
    ('gen5-back', 'png'): f'{SHOWDOWN_BASE_URL}/gen5-back/?sort=name',
    ('ani-back', 'gif'): f'{SHOWDOWN_BASE_URL}/ani-back/?sort=name',
    ('afd-back', 'png'): f'{SHOWDOWN_BASE_URL}/afd-back/?sort=name',
}
SHOWDOWN_BACK_FILES: dict[tuple[str, str], set[str]] = {}

BackAsset = tuple[str, str, str]


def fetch_showdown_file_set(index_url: str, extension: str) -> set[str]:
    response = requests.get(index_url, headers={'User-Agent': USER_AGENT}, timeout=60)
    response.raise_for_status()
    pattern = rf'href="(?:\./)?([^"/]+\.{re.escape(extension)})"'
    return set(re.findall(pattern, response.text))


def load_showdown_back_file_sets() -> None:
    SHOWDOWN_BACK_FILES.clear()
    for key, index_url in SHOWDOWN_BACK_INDEXES.items():
        _, extension = key
        SHOWDOWN_BACK_FILES[key] = fetch_showdown_file_set(index_url, extension)


def showdown_sprite_id(entry: dict[str, Any]) -> str:
    return Path(str(entry['local_path'])).stem


def resolve_showdown_back_asset(
    sprite_id: str,
    candidates: list[tuple[str, str, str]],
) -> BackAsset | None:
    for directory, extension, asset_kind in candidates:
        filename = f'{sprite_id}.{extension}'
        if filename not in SHOWDOWN_BACK_FILES.get((directory, extension), set()):
            continue

        return (
            asset_kind,
            f'{SHOWDOWN_BASE_URL}/{directory}/{filename}',
            f'sprites/showdown/{directory}/{filename}',
        )

    return None


def derive_back_asset(entry: dict[str, Any]) -> BackAsset | None:
    asset_kind = entry['asset_kind']
    remote_url = entry['remote_url']
    local_path = entry['local_path']

    if asset_kind == 'animated-gif':
        return (
            'animated-gif-back',
            remote_url.replace('/anim/normal/', '/anim/back-normal/'),
            local_path.replace('sprites/black-white/anim/normal/', 'sprites/black-white/anim/back-normal/'),
        )

    if asset_kind == 'static-png-fallback':
        return (
            'static-png-back',
            remote_url.replace('/black-white/normal/', '/black-white/back-normal/'),
            local_path.replace('sprites/black-white/normal/', 'sprites/black-white/back-normal/'),
        )

    if asset_kind == 'showdown-gen5-animated-gif':
        sprite_id = showdown_sprite_id(entry)
        return resolve_showdown_back_asset(sprite_id, [
            ('gen5ani-back', 'gif', 'showdown-gen5-animated-gif-back'),
            ('gen5-back', 'png', 'showdown-gen5-static-png-back-fallback'),
            ('ani-back', 'gif', 'showdown-model-animated-gif-back-fallback'),
            ('afd-back', 'png', 'showdown-afd-static-png-back-fallback'),
        ])

    if asset_kind in {'showdown-model-animated-gif-fallback', 'showdown-animated-gif'}:
        sprite_id = showdown_sprite_id(entry)
        return resolve_showdown_back_asset(sprite_id, [
            ('ani-back', 'gif', 'showdown-model-animated-gif-back'),
        ])

    if asset_kind == 'showdown-home-static-png-fallback':
        return None

    if asset_kind in {'showdown-static-png-fallback', 'showdown-afd-static-png-fallback'}:
        sprite_id = showdown_sprite_id(entry)
        return resolve_showdown_back_asset(sprite_id, [
            ('afd-back', 'png', 'showdown-afd-static-png-back'),
        ])

    raise RuntimeError(f'Unsupported front asset kind: {asset_kind}')


def with_back_sprite_metadata(
    entry: dict[str, Any],
    public_root: Path,
    visual_bounds_overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a back-sprite manifest entry with animation and visual bounds."""
    updated = with_animation_metadata(entry, public_root)
    local_path = str(updated.get('local_path', ''))
    sprite_path = public_root / local_path
    if not sprite_path.exists():
        raise FileNotFoundError(f'Sprite listed in manifest does not exist: {sprite_path}')

    extracted_bounds = extract_sprite_visual_bounds_record(sprite_path)
    updated['visual_bounds'] = apply_sprite_visual_bounds_override(
        extracted_bounds,
        species=str(updated.get('species', '')),
        view='back',
        overrides=visual_bounds_overrides,
    )
    return updated


def download_one(
    entry: dict[str, Any],
    visual_bounds_overrides: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    asset = derive_back_asset(entry)
    if asset is None:
        return None

    asset_kind, remote_url, local_path = asset
    response = requests.get(remote_url, headers={'User-Agent': USER_AGENT}, timeout=60)
    response.raise_for_status()

    target = PUBLIC_ROOT / local_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)

    return with_back_sprite_metadata({
        'species': entry['species'],
        'slug': entry['slug'],
        'asset_kind': asset_kind,
        'remote_url': remote_url,
        'local_path': local_path,
        'bytes': len(response.content),
    }, PUBLIC_ROOT, visual_bounds_overrides)


def convert_existing_manifest() -> None:
    manifest = json.loads(BACK_MANIFEST_PATH.read_text())
    visual_bounds_overrides = load_sprite_visual_bounds_overrides(VISUAL_BOUNDS_OVERRIDES_PATH)
    updated = [with_back_sprite_metadata(entry, PUBLIC_ROOT, visual_bounds_overrides) for entry in manifest]
    updated.sort(key=lambda entry: entry['species'])
    BACK_MANIFEST_PATH.write_text(json.dumps(updated, indent=2) + '\n')
    converted = sum(1 for entry in updated if entry.get('animation'))
    bounded = sum(1 for entry in updated if entry.get('visual_bounds'))
    print(f'Converted {converted} existing back GIF spritesheets')
    print(f'Backfilled {bounded} existing back visual bounds')
    print(f'Wrote {BACK_MANIFEST_PATH}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--convert-existing',
        action='store_true',
        help='only generate spritesheets/animation metadata and visual bounds for the current local manifest',
    )
    args = parser.parse_args()
    if args.convert_existing:
        convert_existing_manifest()
        return

    load_showdown_back_file_sets()
    visual_bounds_overrides = load_sprite_visual_bounds_overrides(VISUAL_BOUNDS_OVERRIDES_PATH)
    front_manifest = json.loads(FRONT_MANIFEST_PATH.read_text())
    back_manifest: list[dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(download_one, entry, visual_bounds_overrides) for entry in front_manifest]
        completed = 0
        skipped = 0
        for future in as_completed(futures):
            item = future.result()
            if item is None:
                skipped += 1
            else:
                back_manifest.append(item)
            completed += 1
            if completed % 100 == 0 or completed == len(futures):
                print(f'Downloaded {completed - skipped}/{len(futures)} back sprites ({skipped} skipped)')

    back_manifest.sort(key=lambda entry: entry['species'])
    BACK_MANIFEST_PATH.write_text(json.dumps(back_manifest, indent=2) + '\n')
    print(f'Wrote {BACK_MANIFEST_PATH}')


if __name__ == '__main__':
    main()

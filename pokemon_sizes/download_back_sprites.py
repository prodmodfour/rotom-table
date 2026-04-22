#!/usr/bin/env python3
"""Download back sprite assets corresponding to pokemon_sizes/sprite_manifest.json."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parent
FRONT_MANIFEST_PATH = ROOT / 'sprite_manifest.json'
BACK_MANIFEST_PATH = ROOT / 'back_sprite_manifest.json'
MAX_WORKERS = 16
USER_AGENT = 'rotom-table back sprite downloader'


def derive_back_asset(entry: dict[str, Any]) -> tuple[str, str, str]:
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

    if asset_kind == 'showdown-animated-gif':
        return (
            'showdown-animated-gif-back',
            remote_url.replace('/sprites/ani/', '/sprites/ani-back/'),
            local_path.replace('sprites/showdown/ani/', 'sprites/showdown/ani-back/'),
        )

    if asset_kind == 'showdown-static-png-fallback':
        return (
            'showdown-static-png-back',
            remote_url.replace('/sprites/afd/', '/sprites/afd-back/'),
            local_path.replace('sprites/showdown/afd/', 'sprites/showdown/afd-back/'),
        )

    raise RuntimeError(f'Unsupported front asset kind: {asset_kind}')


def download_one(entry: dict[str, Any]) -> dict[str, Any]:
    asset_kind, remote_url, local_path = derive_back_asset(entry)
    response = requests.get(remote_url, headers={'User-Agent': USER_AGENT}, timeout=60)
    response.raise_for_status()

    target = ROOT / local_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(response.content)

    return {
        'species': entry['species'],
        'slug': entry['slug'],
        'asset_kind': asset_kind,
        'remote_url': remote_url,
        'local_path': local_path,
        'bytes': len(response.content),
    }


def main() -> None:
    front_manifest = json.loads(FRONT_MANIFEST_PATH.read_text())
    back_manifest: list[dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(download_one, entry) for entry in front_manifest]
        completed = 0
        for future in as_completed(futures):
            back_manifest.append(future.result())
            completed += 1
            if completed % 100 == 0 or completed == len(futures):
                print(f'Downloaded {completed}/{len(futures)} back sprites')

    back_manifest.sort(key=lambda entry: entry['species'])
    BACK_MANIFEST_PATH.write_text(json.dumps(back_manifest, indent=2) + '\n')
    print(f'Wrote {BACK_MANIFEST_PATH}')


if __name__ == '__main__':
    main()

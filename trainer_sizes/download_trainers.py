from __future__ import annotations

import io
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup
from PIL import Image

INDEX_URL = 'https://play.pokemonshowdown.com/sprites/trainers/?view=sprites'
BASE_URL = 'https://play.pokemonshowdown.com/sprites/trainers/'
ROOT = Path(__file__).resolve().parent
SPRITES_DIR = ROOT / 'sprites' / 'showdown' / 'trainers'
MANIFEST_PATH = ROOT / 'sprite_manifest.json'
TRAINERS_PATH = ROOT / 'trainers.json'
MAX_HEIGHT_METRES = 2.0
DOWNLOAD_WORKERS = 16
REQUEST_TIMEOUT = 60


@dataclass
class TrainerSource:
    trainer: str
    filename: str
    slug: str
    remote_url: str
    artist: str | None


@dataclass
class TrainerAsset:
    source: TrainerSource
    local_path: str
    bytes: int
    pixel_width: int
    pixel_height: int
    canvas_width: int
    canvas_height: int
    bbox_left: int
    bbox_top: int
    bbox_width: int
    bbox_height: int


def slugify(filename: str) -> str:
    return filename.removesuffix('.png')


def parse_index(session: requests.Session) -> list[TrainerSource]:
    response = session.get(INDEX_URL, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, 'html.parser')

    entries: list[TrainerSource] = []
    for figure in soup.find_all('figure'):
        image = figure.find('img')
        caption = figure.find('figcaption')

        if image is None or caption is None:
            continue

        filename = image.get('src', '').split('/')[-1]
        if not filename.endswith('.png'):
            continue

        link = caption.find('a')
        trainer = link.get_text(strip=True) if link else slugify(filename)
        artist_text = None
        text = caption.get_text('\n', strip=True).splitlines()
        if len(text) > 1 and text[1].startswith('by '):
            artist_text = text[1][3:].strip() or None

        entries.append(
            TrainerSource(
                trainer=trainer,
                filename=filename,
                slug=slugify(filename),
                remote_url=f'{BASE_URL}{filename}',
                artist=artist_text,
            )
        )

    seen: set[str] = set()
    unique_entries: list[TrainerSource] = []
    for entry in entries:
        if entry.filename in seen:
            continue
        seen.add(entry.filename)
        unique_entries.append(entry)

    return unique_entries


def get_non_transparent_bbox(image_bytes: bytes) -> tuple[int, int, int, int, int, int]:
    image = Image.open(io.BytesIO(image_bytes)).convert('RGBA')
    bbox = image.getchannel('A').getbbox()
    if not bbox:
        return (image.width, image.height, 0, 0, 1, 1)
    return (
        image.width,
        image.height,
        bbox[0],
        bbox[1],
        bbox[2] - bbox[0],
        bbox[3] - bbox[1],
    )


def download_one(source: TrainerSource) -> TrainerAsset:
    local_file = SPRITES_DIR / source.filename
    response = requests.get(source.remote_url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    content = response.content
    local_file.write_bytes(content)
    canvas_width, canvas_height, bbox_left, bbox_top, pixel_width, pixel_height = get_non_transparent_bbox(content)
    return TrainerAsset(
        source=source,
        local_path=str(local_file.relative_to(ROOT)).replace('\\', '/'),
        bytes=len(content),
        pixel_width=pixel_width,
        pixel_height=pixel_height,
        canvas_width=canvas_width,
        canvas_height=canvas_height,
        bbox_left=bbox_left,
        bbox_top=bbox_top,
        bbox_width=pixel_width,
        bbox_height=pixel_height,
    )


def round_value(value: float) -> float:
    return round(value, 2)


def build_trainers_json(assets: list[TrainerAsset]) -> list[dict[str, Any]]:
    tallest_pixels = max(asset.pixel_height for asset in assets)
    metres_per_pixel = MAX_HEIGHT_METRES / tallest_pixels

    trainers: list[dict[str, Any]] = []
    for asset in assets:
        height = round_value(asset.pixel_height * metres_per_pixel)
        width = round_value(asset.pixel_width * metres_per_pixel)
        clearance = 1 if height < 1.5 else 2
        trainers.append(
            {
                'trainer': asset.source.trainer,
                'slug': asset.source.slug,
                'width': width,
                'height': height,
                'base': 1,
                'clearance': clearance,
                'artist': asset.source.artist,
            }
        )

    trainers.sort(key=lambda entry: entry['trainer'].lower())
    return trainers


def build_manifest_json(assets: list[TrainerAsset]) -> list[dict[str, Any]]:
    manifest = []
    for asset in sorted(assets, key=lambda item: item.source.trainer.lower()):
        manifest.append(
            {
                'trainer': asset.source.trainer,
                'slug': asset.source.slug,
                'artist': asset.source.artist,
                'remote_url': asset.source.remote_url,
                'local_path': asset.local_path,
                'bytes': asset.bytes,
                'pixel_width': asset.pixel_width,
                'pixel_height': asset.pixel_height,
                'canvas_width': asset.canvas_width,
                'canvas_height': asset.canvas_height,
                'bbox_left': asset.bbox_left,
                'bbox_top': asset.bbox_top,
                'bbox_width': asset.bbox_width,
                'bbox_height': asset.bbox_height,
            }
        )
    return manifest


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    SPRITES_DIR.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({'User-Agent': 'rotom-table trainer sprite downloader'})
    sources = parse_index(session)
    print(f'Found {len(sources)} trainer sprites')

    assets: list[TrainerAsset] = []
    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as executor:
        futures = {executor.submit(download_one, source): source for source in sources}
        completed = 0
        for future in as_completed(futures):
            asset = future.result()
            assets.append(asset)
            completed += 1
            if completed % 100 == 0 or completed == len(sources):
                print(f'Downloaded {completed}/{len(sources)}')

    manifest = build_manifest_json(assets)
    trainers = build_trainers_json(assets)

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + '\n')
    TRAINERS_PATH.write_text(json.dumps(trainers, indent=2) + '\n')
    print(f'Wrote {MANIFEST_PATH}')
    print(f'Wrote {TRAINERS_PATH}')


if __name__ == '__main__':
    main()

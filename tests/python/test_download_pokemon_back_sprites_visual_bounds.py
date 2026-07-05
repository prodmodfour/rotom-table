from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

SCRIPTS_DIR = Path(__file__).resolve().parents[2] / 'scripts'
sys.path.insert(0, str(SCRIPTS_DIR))

import download_pokemon_back_sprites  # noqa: E402


class DownloadPokemonBackSpritesVisualBoundsTest(unittest.TestCase):
    def test_back_sprite_metadata_adds_visual_bounds_to_static_sprite(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            public_root = Path(temp_dir) / 'public'
            sprite_path = public_root / 'sprites' / 'back-example.png'
            sprite_path.parent.mkdir(parents=True)

            image = Image.new('RGBA', (10, 12), (0, 0, 0, 0))
            draw = ImageDraw.Draw(image)
            draw.rectangle((2, 3, 6, 8), fill=(255, 0, 0, 255))
            image.save(sprite_path)

            entry = download_pokemon_back_sprites.with_back_sprite_metadata(
                {
                    'species': 'Examplemon',
                    'slug': 'examplemon',
                    'asset_kind': 'static-png-back',
                    'remote_url': 'https://example.invalid/back-example.png',
                    'local_path': 'sprites/back-example.png',
                    'bytes': sprite_path.stat().st_size,
                    'animation': {'stale': True},
                },
                public_root,
            )

            self.assertNotIn('animation', entry)
            self.assertEqual(
                entry['visual_bounds'],
                {
                    'canvas_width': 10,
                    'canvas_height': 12,
                    'left': 2,
                    'top': 3,
                    'width': 5,
                    'height': 6,
                    'floating': False,
                },
            )

    def test_back_sprite_metadata_preserves_gif_animation_while_adding_visual_bounds(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            public_root = Path(temp_dir) / 'public'
            sprite_path = public_root / 'sprites' / 'animated-back.gif'
            sprite_path.parent.mkdir(parents=True)

            frame_a = Image.new('RGBA', (12, 12), (0, 0, 0, 0))
            draw_a = ImageDraw.Draw(frame_a)
            draw_a.rectangle((1, 2, 3, 4), fill=(255, 0, 0, 255))

            frame_b = Image.new('RGBA', (12, 12), (0, 0, 0, 0))
            draw_b = ImageDraw.Draw(frame_b)
            draw_b.rectangle((7, 6, 9, 8), fill=(0, 0, 255, 255))

            frame_a.save(
                sprite_path,
                save_all=True,
                append_images=[frame_b],
                duration=[80, 120],
                loop=0,
                disposal=2,
            )

            base_entry = {
                'species': 'Animon',
                'slug': 'animon',
                'asset_kind': 'animated-gif-back',
                'remote_url': 'https://example.invalid/animated-back.gif',
                'local_path': 'sprites/animated-back.gif',
                'bytes': sprite_path.stat().st_size,
            }

            first = download_pokemon_back_sprites.with_back_sprite_metadata(base_entry, public_root)
            second = download_pokemon_back_sprites.with_back_sprite_metadata(first, public_root)

            self.assertEqual(second['animation'], first['animation'])
            self.assertEqual(first['animation']['frame_width'], 12)
            self.assertEqual(first['animation']['frame_height'], 12)
            self.assertEqual(first['animation']['frames'], 2)
            self.assertEqual(
                first['visual_bounds'],
                {
                    'canvas_width': 12,
                    'canvas_height': 12,
                    'left': 1,
                    'top': 2,
                    'width': 9,
                    'height': 7,
                    'floating': False,
                },
            )

    def test_convert_existing_manifest_backfills_visual_bounds_and_keeps_species_sort(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            public_root = temp_root / 'public'
            sprite_dir = public_root / 'sprites'
            sprite_dir.mkdir(parents=True)
            manifest_path = temp_root / 'pokemonBackSpriteManifest.json'

            zeta_path = sprite_dir / 'zeta-back.png'
            alpha_path = sprite_dir / 'alpha-back.png'
            Image.new('RGBA', (4, 4), (255, 0, 0, 255)).save(zeta_path)
            Image.new('RGBA', (6, 5), (0, 255, 0, 255)).save(alpha_path)

            manifest_path.write_text(
                json.dumps(
                    [
                        {
                            'species': 'Zetamon',
                            'slug': 'zetamon',
                            'asset_kind': 'static-png-back',
                            'remote_url': 'https://example.invalid/zeta-back.png',
                            'local_path': 'sprites/zeta-back.png',
                            'bytes': zeta_path.stat().st_size,
                        },
                        {
                            'species': 'Alphamon',
                            'slug': 'alphamon',
                            'asset_kind': 'static-png-back',
                            'remote_url': 'https://example.invalid/alpha-back.png',
                            'local_path': 'sprites/alpha-back.png',
                            'bytes': alpha_path.stat().st_size,
                        },
                    ]
                ),
                encoding='utf-8',
            )

            original_public_root = download_pokemon_back_sprites.PUBLIC_ROOT
            original_manifest_path = download_pokemon_back_sprites.BACK_MANIFEST_PATH
            try:
                download_pokemon_back_sprites.PUBLIC_ROOT = public_root
                download_pokemon_back_sprites.BACK_MANIFEST_PATH = manifest_path
                download_pokemon_back_sprites.convert_existing_manifest()
            finally:
                download_pokemon_back_sprites.PUBLIC_ROOT = original_public_root
                download_pokemon_back_sprites.BACK_MANIFEST_PATH = original_manifest_path

            updated = json.loads(manifest_path.read_text(encoding='utf-8'))
            self.assertEqual([entry['species'] for entry in updated], ['Alphamon', 'Zetamon'])
            self.assertTrue(all('visual_bounds' in entry for entry in updated))


if __name__ == '__main__':
    unittest.main()

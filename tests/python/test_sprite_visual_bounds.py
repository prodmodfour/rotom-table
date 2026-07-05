from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from sprite_visual_bounds import (  # noqa: E402
    FLOATING_BOTTOM_GAP_THRESHOLD_PX,
    extract_sprite_visual_bounds,
    extract_sprite_visual_bounds_record,
)


class SpriteVisualBoundsTest(unittest.TestCase):
    def test_extracts_static_png_alpha_bounds(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "grounded.png"
            image = Image.new("RGBA", (10, 12), (0, 0, 0, 0))
            draw = ImageDraw.Draw(image)
            draw.rectangle((2, 3, 6, 8), fill=(255, 0, 0, 255))
            image.save(path)

            self.assertEqual(
                extract_sprite_visual_bounds_record(path),
                {
                    "canvas_width": 10,
                    "canvas_height": 12,
                    "left": 2,
                    "top": 3,
                    "width": 5,
                    "height": 6,
                    "floating": False,
                },
            )

    def test_marks_bottom_gap_at_threshold_as_floating(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "hover.png"
            canvas_height = 20
            bottom = canvas_height - FLOATING_BOTTOM_GAP_THRESHOLD_PX
            image = Image.new("RGBA", (16, canvas_height), (0, 0, 0, 0))
            draw = ImageDraw.Draw(image)
            draw.rectangle((6, 4, 9, bottom - 1), fill=(0, 255, 0, 255))
            image.save(path)

            bounds = extract_sprite_visual_bounds(path)

            self.assertEqual(bounds.height, bottom - 4)
            self.assertTrue(bounds.floating)

    def test_empty_image_falls_back_to_full_canvas_without_floating(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "empty.png"
            Image.new("RGBA", (8, 9), (0, 0, 0, 0)).save(path)

            self.assertEqual(
                extract_sprite_visual_bounds_record(path),
                {
                    "canvas_width": 8,
                    "canvas_height": 9,
                    "left": 0,
                    "top": 0,
                    "width": 8,
                    "height": 9,
                    "floating": False,
                },
            )

    def test_animated_gif_uses_stable_union_of_composited_frames(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "animated.gif"
            frame_a = Image.new("RGBA", (12, 12), (0, 0, 0, 0))
            draw_a = ImageDraw.Draw(frame_a)
            draw_a.rectangle((1, 2, 3, 4), fill=(255, 0, 0, 255))

            frame_b = Image.new("RGBA", (12, 12), (0, 0, 0, 0))
            draw_b = ImageDraw.Draw(frame_b)
            draw_b.rectangle((7, 6, 9, 8), fill=(0, 0, 255, 255))

            frame_a.save(
                path,
                save_all=True,
                append_images=[frame_b],
                duration=[80, 120],
                loop=0,
                disposal=2,
            )

            expected = {
                "canvas_width": 12,
                "canvas_height": 12,
                "left": 1,
                "top": 2,
                "width": 9,
                "height": 7,
                "floating": False,
            }
            self.assertEqual(extract_sprite_visual_bounds_record(path), expected)
            self.assertEqual(extract_sprite_visual_bounds_record(path), expected)


if __name__ == "__main__":
    unittest.main()

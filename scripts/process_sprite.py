#!/usr/bin/env python3
"""
Sprite Sheet Processor for The Solana City

Processes raw sprite sheets into engine-ready format:
  - Removes background color (pink, black, or custom)
  - Reorders direction rows to match engine expectations
  - Resizes to target frame size
  - Outputs transparent PNG

Usage:
  python process_sprite.py input.png output.png [options]

Options:
  --bg RRGGBB      Background color to remove (hex, default: FF427E for pink)
  --tolerance N     Color match tolerance (default: 35)
  --frame-size WxH  Target frame size (default: 48x48)
  --input-order     Row order in input (default: down,right,up,left)
  --no-reorder      Skip row reordering

Sprite sheet contract:
  - 4 columns (walk animation frames)
  - 4 rows (directions)
  - Engine expects rows: down, left, right, up
  - Most generators output: down, right, up, left

Examples:
  python process_sprite.py raw/knight.png sprites/knight.png
  python process_sprite.py raw/mage.png sprites/mage.png --bg 000000
  python process_sprite.py raw/boss.png sprites/boss.png --frame-size 64x64
"""

import sys
import os
from PIL import Image

ENGINE_ORDER = ["down", "left", "right", "up"]
DEFAULT_INPUT_ORDER = ["down", "right", "up", "left"]


def remove_background(img, bg_color, tolerance=35):
    img = img.convert("RGBA")
    pixels = img.load()
    w, h = img.size

    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            dr = abs(r - bg_color[0])
            dg = abs(g - bg_color[1])
            db = abs(b - bg_color[2])

            if dr < tolerance and dg < tolerance and db < tolerance:
                pixels[x, y] = (0, 0, 0, 0)
            elif dr < tolerance * 2 and dg < tolerance * 2 and db < tolerance * 2:
                dist = (dr + dg + db) / 3
                alpha_factor = min(dist / (tolerance * 2), 1.0)
                pixels[x, y] = (r, g, b, int(a * alpha_factor))

    return img


def reorder_rows(img, frame_h, from_order, to_order):
    w = img.size[0]
    rows = {}
    for i, direction in enumerate(from_order):
        row = img.crop((0, i * frame_h, w, (i + 1) * frame_h))
        rows[direction] = row

    result = Image.new("RGBA", img.size, (0, 0, 0, 0))
    for i, direction in enumerate(to_order):
        result.paste(rows[direction], (0, i * frame_h))

    return result


def process_sprite(
    input_path,
    output_path,
    bg_color=(244, 66, 126),
    tolerance=35,
    frame_size=(48, 48),
    input_order=None,
    reorder=True,
):
    if input_order is None:
        input_order = DEFAULT_INPUT_ORDER

    img = Image.open(input_path).convert("RGBA")
    print(f"Input: {img.size[0]}x{img.size[1]}")

    # Detect if background needs removal (check corner pixel)
    corner = img.getpixel((0, 0))
    if corner[3] > 200:  # Not already transparent
        dr = abs(corner[0] - bg_color[0])
        dg = abs(corner[1] - bg_color[1])
        db = abs(corner[2] - bg_color[2])
        if dr < tolerance * 2 and dg < tolerance * 2 and db < tolerance * 2:
            print(f"Removing background: rgb({bg_color[0]},{bg_color[1]},{bg_color[2]})")
            img = remove_background(img, bg_color, tolerance)
        else:
            # Try black background
            if corner[0] < 20 and corner[1] < 20 and corner[2] < 20:
                print("Removing black background")
                img = remove_background(img, (0, 0, 0), 15)
            else:
                print(f"Background auto-detected as rgb({corner[0]},{corner[1]},{corner[2]})")
                img = remove_background(img, (corner[0], corner[1], corner[2]), tolerance)

    # Resize to target
    target_w = frame_size[0] * 4
    target_h = frame_size[1] * 4
    if img.size != (target_w, target_h):
        print(f"Resizing: {img.size[0]}x{img.size[1]} -> {target_w}x{target_h}")
        img = img.resize((target_w, target_h), Image.NEAREST)

    # Reorder rows
    if reorder:
        print(f"Reordering: {input_order} -> {ENGINE_ORDER}")
        img = reorder_rows(img, frame_size[1], input_order, ENGINE_ORDER)

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    img.save(output_path)
    print(f"Output: {output_path} ({img.size[0]}x{img.size[1]})")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    bg_color = (244, 66, 126)  # pink
    tolerance = 35
    frame_size = (48, 48)
    input_order = DEFAULT_INPUT_ORDER
    reorder = False

    i = 3
    while i < len(sys.argv):
        if sys.argv[i] == "--bg" and i + 1 < len(sys.argv):
            hex_color = sys.argv[i + 1]
            bg_color = (
                int(hex_color[0:2], 16),
                int(hex_color[2:4], 16),
                int(hex_color[4:6], 16),
            )
            i += 2
        elif sys.argv[i] == "--tolerance" and i + 1 < len(sys.argv):
            tolerance = int(sys.argv[i + 1])
            i += 2
        elif sys.argv[i] == "--frame-size" and i + 1 < len(sys.argv):
            parts = sys.argv[i + 1].split("x")
            frame_size = (int(parts[0]), int(parts[1]))
            i += 2
        elif sys.argv[i] == "--input-order" and i + 1 < len(sys.argv):
            input_order = sys.argv[i + 1].split(",")
            i += 2
        elif sys.argv[i] == "--no-reorder":
            reorder = False
            i += 1
        else:
            i += 1

    process_sprite(input_path, output_path, bg_color, tolerance, frame_size, input_order, reorder)

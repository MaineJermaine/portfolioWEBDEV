"""
Small WebP thumbnails of every project screenshot, for the teaser carousel that
plays above the "Selected Work" sign in the 3D world.

Reads the image lists from the data-media="..." attributes in index.html, so
adding a screenshot to a project there and re-running this is all it takes.

    "C:\\Program Files\\Blender Foundation\\Blender 5.3\\blender.exe" -b -P blender/make_thumbs.py

Output: assets/thumbs/<path-with-dashes>.webp   (e.g. plateloop/2-kiosk.jpg -> plateloop-2-kiosk.webp)
        assets/thumbs/teaser.json             the shots bright enough to be worth showing
"""
import array
import json
import os
import re

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "assets", "thumbs")
WIDTH, QUALITY = 640, 72
MIN_BRIGHTNESS = 0.07   # near-black frames (loading screens, dark corridors) make a dull teaser


def brightness(img):
    buf = array.array("f", [0.0]) * (len(img.pixels))
    img.pixels.foreach_get(buf)
    n = len(buf) // 4
    return (sum(buf[0::4]) * 0.299 + sum(buf[1::4]) * 0.587 + sum(buf[2::4]) * 0.114) / max(1, n)


def thumb_name(path):
    return re.sub(r"\.[^.]+$", "", path).replace("/", "-") + ".webp"


def main():
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        html = f.read()
    files = []
    for attr in re.findall(r'data-media="([^"]+)"', html):
        files += [p.strip() for p in attr.split(",")
                  if p.strip() and not p.strip().startswith("http") and not p.lower().endswith(".mp4")]
    os.makedirs(OUT, exist_ok=True)
    total, teaser = 0, []
    for rel in dict.fromkeys(files):          # de-duplicate, keep order
        src = os.path.join(ROOT, rel)
        if not os.path.exists(src):
            print(f"[thumbs] missing {rel}")
            continue
        img = bpy.data.images.load(src)
        w, h = img.size
        if w > WIDTH:
            img.scale(WIDTH, max(1, round(h * WIDTH / w)))
        lum = brightness(img)
        dst = os.path.join(OUT, thumb_name(rel))
        img.filepath_raw = dst
        img.file_format = "WEBP"
        img.save(filepath=dst, quality=QUALITY)
        bpy.data.images.remove(img)
        kb = os.path.getsize(dst) // 1024
        total += kb
        keep = lum >= MIN_BRIGHTNESS
        if keep:
            teaser.append({"src": rel, "thumb": f"assets/thumbs/{thumb_name(rel)}"})
        print(f"[thumbs] {rel} -> {thumb_name(rel)} ({kb} KB, brightness {lum:.3f}{'' if keep else ', skipped in teaser'})")
    with open(os.path.join(OUT, "teaser.json"), "w") as f:
        json.dump(teaser, f, indent=1)
    print(f"[thumbs] done, {total} KB total, {len(teaser)} shots in teaser.json")


main()

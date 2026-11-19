# Artwork

Everything listed in `art.json` shows up in two places:

- **The 3D art room**: hung in the picture frames.
- **The 2D page**: in the "Art" gallery, grouped by category, in list order.

## Adding a piece

1. Put the image in this folder (`.jpg`, `.png` or `.webp`). Use a simple filename with no spaces, like `my-painting.jpg`.
2. Add an entry to `art.json`:

```json
{
  "artworks": [
    {
      "file": "assets/art/my-painting.jpg",
      "thumb": "assets/art/web/my-painting.webp",
      "title": "Evening on the balcony",
      "category": "Sketches",
      "year": "2026",
      "medium": "Digital painting",
      "size": "",
      "note": "A short line about the piece.",
      "frame": 4
    }
  ]
}
```

Only `file` is required. Everything else is optional:

- `category` groups pieces in the 2D gallery, such as `"GFX"` or `"Sketches"`. Any name works; each new one gets its own group, in the order it first appears in the list.
- `title`, `category`, `year`, `medium`, `size` and `note` appear on the label beside the frame and in the full-size view.
- `thumb` is a smaller copy (about 1600 px on the long side). The room and the 2D gallery load it instead of the full file, which keeps the page fast; the full file only loads when someone opens the piece full size. The copies for the current pieces are in `web/`.
- `frame` picks which frame the piece hangs in (see below).

## Where each piece hangs

The room has 10 frames:

| Frame | Where | Shape |
|---|---|---|
| 01 | Above the couch (the first thing visitors see) | landscape |
| 02, 03 | Gallery wall, either side of 01 | portrait |
| 04 | Above the bed (the biggest) | wide landscape |
| 05, 06 | Either side of the bed | portrait |
| 07 | Above the dresser | wide landscape |
| 08 | Beside the dresser | portrait |
| 09 | Above the desk | landscape |
| 10 | On the easel | portrait |

A piece with `"frame": n` hangs in frame n. A piece without one goes to the free frame whose shape is closest to its own, so wide pieces end up in the landscape frames and tall ones in the portrait frames. Each frame then resizes to the exact shape of its artwork.

You can list more than 10 pieces. The extras don't hang in the room, but they still appear in the 2D gallery and in the full-size viewer.

To move or add frames, edit `SLOTS` at the top of `assets/room/room.js`.

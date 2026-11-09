#!/usr/bin/env python3
"""
Builds the desktop widget's Braille frames from your own art, in ~/.secptile/widget/:

  base.txt    the normal form (shown in grey)
  mega.txt    the mega form (shown in colour)
  symbol.txt  the mega evolution symbol that plays over the sprite while evolving

Writes frames.js beside them. Expressions change only a few dots: the eye is
swapped and the lower jaw moves. The face positions below are tuned to these
exact drawings, so different art needs new numbers. The art stays out of the repo.
"""
from __future__ import annotations

import json
import random
import sys
from dataclasses import dataclass
from pathlib import Path

WIDGET_DIR = Path.home() / ".secptile" / "widget"

Dot = tuple[int, int]
BITS = {(0, 0): 1, (0, 1): 2, (0, 2): 4, (1, 0): 8, (1, 1): 16, (1, 2): 32, (0, 3): 64, (1, 3): 128}

GREY = "#8a8f98"
GOLD = "#ffd43b"
RED = "#ff4b4b"
LIME = "#a6e85f"
GREEN = "#5fd16b"
DEEP_GREEN = "#2fa84f"
CREAM = "#f1e7a0"
WHITE = "#ffffff"
# Colours of the mega evolution symbol, top to bottom, plus its outline.
SYMBOL_OUTLINE = "#7d3f83"
SYMBOL_STOPS = ["#ee9f86", "#e3d268", "#b6d060", "#8ec9dc", "#6fb1dc", "#ecaccb"]
SYMBOL_STEPS = 16
SYMBOL_SLANT = 0.35


def blend_stops(stops: list[str], steps: int) -> list[str]:
    """Evenly spaced colours along the stops, so the gradient has no hard bands."""
    channels = [[int(stop[i:i + 2], 16) for i in (1, 3, 5)] for stop in stops]
    colors = []
    for step in range(steps):
        place = step / (steps - 1) * (len(stops) - 1)
        low = min(int(place), len(stops) - 2)
        mix = place - low
        colors.append("#" + "".join(
            f"{round(a + (b - a) * mix):02x}" for a, b in zip(channels[low], channels[low + 1])
        ))
    return colors


SYMBOL_GRADIENT = blend_stops(SYMBOL_STOPS, SYMBOL_STEPS)

PALETTE_LETTERS = {
    color: letter
    for letter, color in zip(
        "abcdefghijklmnopqrstuvwxyz",
        [GREY, GOLD, RED, LIME, GREEN, DEEP_GREEN, CREAM, WHITE, SYMBOL_OUTLINE, *SYMBOL_GRADIENT],
    )
}


@dataclass(frozen=True)
class Form:
    """Where each sprite's face is, in dots from its own top-left corner."""
    pupil: frozenset[Dot]
    eye: Dot                    # centre of the eye, for redrawn lids
    jaw_box: tuple[int, int, int, int]  # x0, y0, x1, y1: the part that moves
    resting_jaw: int            # jaw shift when asleep
    z_at: Dot
    thought_at: Dot
    sound_at: Dot


BASE_FORM = Form(
    pupil=frozenset({(46, 22), (47, 22), (48, 22), (49, 22), (47, 23)}),
    eye=(47, 22),
    jaw_box=(34, 26, 46, 32),
    resting_jaw=-1,
    z_at=(60, 12),
    thought_at=(60, 14),
    sound_at=(28, 26),
)
MEGA_FORM = Form(
    pupil=frozenset({(34, 28), (35, 28), (34, 29), (35, 29)}),
    eye=(34, 28),
    jaw_box=(29, 36, 42, 39),
    resting_jaw=-1,
    z_at=(58, 10),
    thought_at=(56, 12),
    sound_at=(20, 33),
)


def read_dots(path: Path) -> set[Dot]:
    dots: set[Dot] = set()
    for row_index, row in enumerate(path.read_text(encoding="utf8").split("\n")):
        for col_index, char in enumerate(row):
            pattern = ord(char) - 0x2800
            if 0 <= pattern < 256:
                for (dx, dy), bit in BITS.items():
                    if pattern & bit:
                        dots.add((col_index * 2 + dx, row_index * 4 + dy))
    return dots


def line(a: Dot, b: Dot) -> set[Dot]:
    steps = max(abs(b[0] - a[0]), abs(b[1] - a[1]), 1)
    return {
        (round(a[0] + (b[0] - a[0]) * i / steps), round(a[1] + (b[1] - a[1]) * i / steps))
        for i in range(steps + 1)
    }


def polyline(points: list[Dot]) -> set[Dot]:
    dots: set[Dot] = set()
    for a, b in zip(points, points[1:]):
        dots |= line(a, b)
    return dots


def shift(dots: set[Dot] | frozenset[Dot], dx: int, dy: int) -> set[Dot]:
    return {(x + dx, y + dy) for x, y in dots}


def eye_dots(form: Form, kind: str) -> set[Dot]:
    x, y = form.eye
    if kind == "open":
        return set(form.pupil)
    if kind == "left":
        return shift(form.pupil, -1, 0)
    if kind == "right":
        return shift(form.pupil, 1, 0)
    if kind == "up":
        return shift(form.pupil, 0, -1)
    if kind == "wide":
        return {(x + dx, y + dy) for dx in range(-1, 2) for dy in range(-1, 2)}
    if kind == "blink":
        return line((x - 2, y), (x + 2, y))
    if kind == "closed":
        return polyline([(x - 2, y - 1), (x - 1, y), (x + 1, y), (x + 2, y - 1)])
    if kind == "happy":
        return polyline([(x - 2, y + 1), (x - 1, y), (x + 1, y), (x + 2, y + 1)])
    raise ValueError(kind)


def pose(art: set[Dot], form: Form, eye_kind: str, jaw_shift: int, *extras: set[Dot]) -> set[Dot]:
    x0, y0, x1, y1 = form.jaw_box
    jaw = {(x, y) for x, y in art if x0 <= x < x1 and y0 <= y < y1}
    dots = (art - jaw - form.pupil) | shift(jaw, 0, jaw_shift) | eye_dots(form, eye_kind)
    for extra in extras:
        dots |= extra
    return dots


def zed(x: int, y: int, size: int) -> set[Dot]:
    return polyline([(x, y), (x + size, y), (x, y + size), (x + size, y + size)])


def build_poses(art: set[Dot], form: Form) -> dict[str, set[Dot]]:
    zx, zy = form.z_at
    z1 = zed(zx, zy, 3)
    z2 = z1 | zed(zx + 5, zy - 6, 4)
    z3 = z2 | zed(zx + 11, zy - 13, 5)
    tx, ty = form.thought_at
    thoughts = [
        {(tx + dx, ty + dy) for dx in (0, 1) for dy in (0, 1)},
        {(tx + 5 + dx, ty - 4 + dy) for dx in (0, 1) for dy in (0, 1)},
        {(tx + 10 + dx, ty - 8 + dy) for dx in (0, 1) for dy in (0, 1)},
    ]
    sx, sy = form.sound_at
    arc1 = polyline([(sx + 1, sy), (sx, sy + 2), (sx + 1, sy + 4)])
    arc2 = arc1 | polyline([(sx - 2, sy - 1), (sx - 3, sy + 2), (sx - 2, sy + 5)])
    rest = form.resting_jaw
    return {
        "sleep0": pose(art, form, "closed", rest, z1),
        "sleep1": pose(art, form, "closed", rest, z2),
        "sleep2": pose(art, form, "closed", rest, z3),
        "idle": pose(art, form, "open", 0),
        "blink": pose(art, form, "blink", 0),
        "left": pose(art, form, "left", 0),
        "right": pose(art, form, "right", 0),
        "happy": pose(art, form, "happy", 1),
        "wide": pose(art, form, "wide", 1),
        "think0": pose(art, form, "up", rest, thoughts[0]),
        "think1": pose(art, form, "up", rest, thoughts[0] | thoughts[1]),
        "think2": pose(art, form, "up", rest, thoughts[0] | thoughts[1] | thoughts[2]),
        "talk0": pose(art, form, "open", 1, arc1),
        "talk1": pose(art, form, "open", 3, arc2),
        "talk2": pose(art, form, "happy", 2, arc1),
        "talk3": pose(art, form, "open", 0),
    }


def bounds(dots: set[Dot]) -> tuple[int, int, int, int]:
    xs = [x for x, _ in dots]
    ys = [y for _, y in dots]
    return min(xs), min(ys), max(xs), max(ys)


def symbol_regions(outline: set[Dot]) -> set[Dot]:
    """
    The dots to fill inside the symbol's outline, keeping its holes open.
    Each time you cross a line you swap between outside and fill, so regions
    are coloured in layers working in from the outer edge.
    """
    x0, y0, x1, y1 = bounds(outline)
    x0, y0, x1, y1 = x0 - 1, y0 - 1, x1 + 1, y1 + 1
    # Thicken the outline for the flood, so it can't leak through dotted gaps.
    wall = outline | {(x + dx, y + dy) for x, y in outline for dx in (-1, 0, 1) for dy in (-1, 0, 1)}

    def flood(start: Dot, seen: set[Dot]) -> set[Dot]:
        region = {start}
        seen.add(start)
        stack = [start]
        while stack:
            x, y = stack.pop()
            for next_dot in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                nx, ny = next_dot
                if x0 <= nx <= x1 and y0 <= ny <= y1 and next_dot not in wall and next_dot not in seen:
                    seen.add(next_dot)
                    region.add(next_dot)
                    stack.append(next_dot)
        return region

    seen: set[Dot] = set()
    outside = flood((x0, y0), seen)
    regions = [
        flood((x, y), seen)
        for x in range(x0, x1 + 1)
        for y in range(y0, y1 + 1)
        if (x, y) not in wall and (x, y) not in seen
    ]

    def touching(a: set[Dot], b: set[Dot]) -> bool:
        reach = 3  # the thickened line between two regions
        return any(
            (x + dx, y + dy) in b
            for x, y in a
            for dx in range(-reach, reach + 1)
            for dy in range(-reach, reach + 1)
        )

    filled: set[Dot] = set()
    open_side = outside
    remaining = regions
    fill_this_layer = True
    while remaining:
        layer = [region for region in remaining if touching(region, open_side)]
        if not layer:
            break
        remaining = [region for region in remaining if region not in layer]
        layer_dots = set().union(*layer)
        if fill_this_layer:
            filled |= layer_dots
        open_side = layer_dots
        fill_this_layer = not fill_this_layer
    # Between the fill and the line, the thickened wall counts as fill too.
    return {
        (x + dx, y + dy)
        for x, y in filled
        for dx in (-1, 0, 1)
        for dy in (-1, 0, 1)
    } - outline


class Canvas:
    """The grid every frame shares, trimmed to what any frame draws on."""

    def __init__(self, all_dots: set[Dot]) -> None:
        x0, y0, x1, y1 = bounds(all_dots)
        self.col0, self.col1 = x0 // 2, x1 // 2 + 1
        self.row0, self.row1 = y0 // 4, y1 // 4 + 1

    def cells(self, dots: set[Dot]) -> dict[tuple[int, int], int]:
        cells: dict[tuple[int, int], int] = {}
        for x, y in dots:
            key = (x // 2, y // 4)
            cells[key] = cells.get(key, 0) | BITS[(x % 2, y % 4)]
        return cells

    def rows(self, dots: set[Dot]) -> list[str]:
        cells = self.cells(dots)
        return [
            "".join(chr(0x2800 + cells.get((col, row), 0)) for col in range(self.col0, self.col1))
            for row in range(self.row0, self.row1)
        ]

    def colors(self, dots: set[Dot], color_of) -> list[str]:
        """One palette letter per cell, row by row. Blank cells are spaces."""
        cells = self.cells(dots)
        return [
            "".join(
                PALETTE_LETTERS[color_of(col, row)] if cells.get((col, row)) else " "
                for col in range(self.col0, self.col1)
            )
            for row in range(self.row0, self.row1)
        ]


def build(widget_dir: Path = WIDGET_DIR) -> dict:
    base = read_dots(widget_dir / "base.txt")
    mega = read_dots(widget_dir / "mega.txt")
    symbol = read_dots(widget_dir / "symbol.txt")

    base_poses = build_poses(base, BASE_FORM)
    mega_poses = build_poses(mega, MEGA_FORM)

    # Line the sprites up: same centre, standing on the same ground line.
    bx0, _, bx1, by1 = bounds(base)
    mx0, _, mx1, my1 = bounds(mega)
    mega_dx = (bx0 + bx1) // 2 - (mx0 + mx1) // 2
    mega_dy = by1 - my1
    mega_poses = {name: shift(dots, mega_dx, mega_dy) for name, dots in mega_poses.items()}
    placed_mega = shift(mega, mega_dx, mega_dy)

    # The symbol plays over the middle of the sprite.
    sx0, sy0, sx1, sy1 = bounds(symbol)
    px0, py0, px1, py1 = bounds(base | placed_mega)
    symbol_dx = (px0 + px1) // 2 - (sx0 + sx1) // 2
    symbol_dy = (py0 + py1) // 2 - (sy0 + sy1) // 2
    outline = shift(symbol, symbol_dx, symbol_dy)
    inside = symbol_regions(outline)
    symbol_x0, symbol_y0, symbol_x1, symbol_y1 = bounds(outline)

    all_dots = outline | inside
    for dots in list(base_poses.values()) + list(mega_poses.values()):
        all_dots |= dots
    canvas = Canvas(all_dots)

    def to_sprite(col: int, row: int) -> Dot:
        return col * 2 + 1 - mega_dx, row * 4 + 2 - mega_dy

    jaw_x0, jaw_y0, jaw_x1, jaw_y1 = MEGA_FORM.jaw_box

    def mega_color(col: int, row: int) -> str:
        x, y = to_sprite(col, row)
        if 31 <= x <= 38 and 26 <= y <= 31:
            return GOLD                # eye
        if jaw_x0 <= x <= jaw_x1 and jaw_y0 - 2 <= y <= jaw_y1 + 4:
            return RED                 # lower jaw
        if y < 40:
            return LIME                # head and crest
        if 30 <= x <= 58 and y < 66:
            return GOLD                # pods on the chest
        if x >= 58 and y < 74:
            return RED if x >= 80 else LIME  # arm blades, red at the tips
        if x >= 64 and y >= 96:
            return LIME                # leg and claws
        if y >= 126:
            return RED                 # tail tips
        if x <= 56 and y >= 80:
            return DEEP_GREEN          # tail
        return GREEN                   # body

    frames: dict[str, dict] = {}
    for name, dots in base_poses.items():
        frames[f"mono.{name}"] = {"rows": canvas.rows(dots)}
    for name, dots in mega_poses.items():
        frames[f"mega.{name}"] = {"rows": canvas.rows(dots), "colors": canvas.colors(dots, mega_color)}

    # Mega evolving: the symbol dissolves in over the grey sprite, flashes while
    # the sprite changes underneath it, then dissolves away over the colour one.
    rng = random.Random(3)
    symbol_dots = outline | inside
    symbol_cells = set(canvas.cells(symbol_dots))
    # A thin outline, as in the symbol: only cells with no fill in them are purple.
    outline_cells = set(canvas.cells(outline)) - set(canvas.cells(inside))
    delays = {cell: rng.random() for cell in symbol_cells}

    def symbol_color(col: int, row: int) -> str:
        if (col, row) in outline_cells:
            return SYMBOL_OUTLINE
        # Runs top to bottom with a slight diagonal, as in the symbol.
        y = row * 4 + 2 + (symbol_x1 - col * 2) * SYMBOL_SLANT
        place = (y - symbol_y0) / max(1, symbol_y1 - symbol_y0 + (symbol_x1 - symbol_x0) * SYMBOL_SLANT)
        index = max(0, min(len(SYMBOL_GRADIENT) - 1, int(place * len(SYMBOL_GRADIENT))))
        return SYMBOL_GRADIENT[index]

    def evolve_frame(amount: float, grey_sprite: bool, flash: bool = False) -> dict:
        sprite = base_poses["idle"] if grey_sprite else mega_poses["idle"]
        shown = {
            cell for cell in symbol_cells if delays[cell] < amount
        }
        # The symbol sits on top: the sprite is hidden wherever it shows.
        dots = {dot for dot in sprite if (dot[0] // 2, dot[1] // 4) not in shown}
        dots |= {dot for dot in symbol_dots if (dot[0] // 2, dot[1] // 4) in shown}

        def color(col: int, row: int) -> str:
            if (col, row) in shown:
                return WHITE if flash else symbol_color(col, row)
            return GREY if grey_sprite else mega_color(col, row)

        return {"rows": canvas.rows(dots), "colors": canvas.colors(dots, color)}

    appear_frames = 6
    hold_frames = 10
    fade_frames = 8
    evolve = [evolve_frame((i + 1) / appear_frames, True) for i in range(appear_frames)]
    for i in range(hold_frames):
        swapped = i >= hold_frames // 2
        flash = i in (hold_frames // 2 - 1, hold_frames // 2)
        evolve.append(evolve_frame(1.01, not swapped, flash))
    evolve += [evolve_frame(1 - (i + 1) / fade_frames, False) for i in range(fade_frames)]

    return {
        "columns": canvas.col1 - canvas.col0,
        "rows": canvas.row1 - canvas.row0,
        "grey": GREY,
        "palette": {letter: color for color, letter in PALETTE_LETTERS.items()},
        "frames": frames,
        "evolve": evolve,
    }


def main() -> int:
    missing = [name for name in ("base.txt", "mega.txt", "symbol.txt") if not (WIDGET_DIR / name).exists()]
    if missing:
        print(f"Put your Braille art in {WIDGET_DIR}: missing {', '.join(missing)}.", file=sys.stderr)
        return 1
    data = build()
    target = WIDGET_DIR / "frames.js"
    target.write_text(
        ".pragma library\nvar data = " + json.dumps(data, ensure_ascii=False) + ";\n",
        encoding="utf8",
    )
    print(f"{len(data['frames'])} frames, {len(data['evolve'])} evolve, "
          f"{data['columns']}x{data['rows']} cells, {target.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())

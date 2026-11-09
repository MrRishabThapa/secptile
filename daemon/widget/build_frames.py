#!/usr/bin/env python3
"""
Builds the desktop widget's Braille frames from your own art.

Reads  ~/.secptile/widget/base.txt  (the normal form, in Braille)
and optionally  ~/.secptile/widget/mega.txt  (your own mega form, same grid).
Writes ~/.secptile/widget/frames.js

Expressions are made by editing dots: the eyes are redrawn, the jaw curve is
stretched to open the mouth. The art stays outside this repo on purpose.
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

WIDGET_DIR = Path.home() / ".secptile" / "widget"

Dot = tuple[int, int]
BITS = {(0, 0): 1, (0, 1): 2, (0, 2): 4, (1, 0): 8, (1, 1): 16, (1, 2): 32, (0, 3): 64, (1, 3): 128}

# Where the face sits in base.txt, in dots (2 per column, 4 per row).
EYE_BOX = (71, 32, 84, 39)
JAW_BOX = (57, 44, 86, 57)
JAW_TOP = 43
JAW_CURVE: list[Dot] = [
    (59, 43), (61, 45), (64, 47), (67, 49), (70, 50), (72, 52), (75, 53), (78, 52),
    (80, 51), (82, 49), (83, 47), (84, 44), (84, 42),
]
CHIN = [(74, 54), (74, 55)]

GREY = "#8a8f98"
GOLD = "#ffd43b"
RED = "#ff4b4b"
LIME = "#a6e85f"
GREEN = "#5fd16b"
DEEP_GREEN = "#2fa84f"
CREAM = "#f1e7a0"
WHITE = "#ffffff"
PALETTE_LETTERS = {
    color: letter
    for letter, color in zip("abcdefgh", [GREY, GOLD, RED, LIME, GREEN, DEEP_GREEN, CREAM, WHITE])
}

# Mega form, drawn on top of the base art in dots: leafy blades, pods on the
# body and a banded tail. Put your own art in mega.txt to replace all of this.
MEGA_LEAVES: list[list[Dot]] = [
    # Crest sweeping back from the head.
    [(62, 24), (50, 4), (70, 17)],
    [(58, 32), (40, 14), (61, 26)],
    [(72, 16), (68, 1), (82, 15)],
    # Left forearm blades.
    [(46, 88), (6, 58), (34, 96)],
    [(36, 96), (0, 86), (28, 104)],
    # Right forearm blades.
    [(118, 96), (154, 64), (130, 102)],
    [(128, 104), (162, 86), (134, 110)],
]
MEGA_TAIL_BANDS: list[list[Dot]] = [
    [(150, 128), (176, 94), (160, 130)],
    [(160, 132), (190, 106), (172, 136)],
    [(172, 144), (200, 128), (178, 150)],
    [(132, 150), (138, 176)],
    [(146, 150), (154, 178)],
    [(160, 150), (170, 174)],
]
# (x, y, radius)
MEGA_GOLD_PODS: list[tuple[int, int, int]] = [(84, 70, 4), (92, 82, 5), (84, 94, 5), (72, 106, 4)]
MEGA_RED_PODS: list[tuple[int, int, int]] = [(100, 70, 4), (108, 86, 4)]


def disc(x: int, y: int, radius: int) -> set[Dot]:
    return {
        (x + dx, y + dy)
        for dx in range(-radius, radius + 1)
        for dy in range(-radius, radius + 1)
        if dx * dx + dy * dy <= radius * radius
    }


def read_dots(path: Path) -> set[Dot]:
    dots: set[Dot] = set()
    rows = [row for row in path.read_text(encoding="utf8").split("\n") if row]
    for row_index, row in enumerate(rows):
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


def clear(dots: set[Dot], box: tuple[int, int, int, int]) -> set[Dot]:
    x0, y0, x1, y1 = box
    return {(x, y) for x, y in dots if not (x0 <= x < x1 and y0 <= y < y1)}


def eye(kind: str, fierce: bool = False) -> set[Dot]:
    """Each eye is drawn in the same box: brow on top, pupil below."""
    brow = polyline([(72, 32), (79, 35)]) if fierce else line((72, 34), (78, 34))
    pupil = line((78, 35), (78, 38)) | line((79, 35), (79, 38)) | line((81, 35), (81, 37))
    if kind == "open":
        return brow | pupil
    if kind == "left":
        return brow | {(x - 4, y) for x, y in pupil}
    if kind == "right":
        return brow | {(x + 1, y) for x, y in pupil}
    if kind == "up":
        return line((73, 33), (79, 33)) | {(x - 1, y - 1) for x, y in pupil}
    if kind == "wide":
        return line((72, 33), (79, 33)) | pupil | line((76, 35), (76, 38)) | line((77, 38), (81, 38))
    if kind == "blink":
        return line((73, 36), (82, 36))
    if kind == "closed":
        return polyline([(72, 34), (75, 36), (79, 36), (82, 34)])
    if kind == "happy":
        return polyline([(72, 37), (75, 34), (78, 34), (81, 37)])
    raise ValueError(kind)


def mouth(openness: float) -> set[Dot]:
    """Stretches the jaw curve: 1.0 is your drawing, smaller closes, larger opens."""
    moved = [(x, round(JAW_TOP + (y - JAW_TOP) * openness)) for x, y in JAW_CURVE]
    dots = polyline(moved)
    chin_shift = round((JAW_TOP + 10 * openness) - 53)
    dots |= {(x, y + chin_shift) for x, y in CHIN}
    return dots


def zed(x: int, y: int, size: int) -> set[Dot]:
    return polyline([(x, y), (x + size, y), (x, y + size), (x + size, y + size)])


def pose(base: set[Dot], eye_kind: str, openness: float, fierce: bool, *extras: set[Dot]) -> set[Dot]:
    dots = clear(clear(base, EYE_BOX), JAW_BOX)
    dots |= eye(eye_kind, fierce) | mouth(openness)
    for extra in extras:
        dots |= extra
    return dots


def sound_arcs(count: int) -> set[Dot]:
    dots: set[Dot] = set()
    for index in range(count):
        x = 49 - index * 4
        dots |= polyline([(x + 1, 42 - index), (x, 46), (x + 1, 50 + index)])
    return dots


def thinking_dots(count: int) -> set[Dot]:
    return {
        (x + dx, y + dy)
        for x, y in [(96, 20), (102, 14), (109, 8)][:count]
        for dx in (0, 1)
        for dy in (0, 1)
    }


def build_poses(base: set[Dot], fierce: bool) -> dict[str, set[Dot]]:
    sleep_z = [
        zed(94, 22, 4),
        zed(94, 22, 4) | zed(101, 13, 6),
        zed(94, 22, 4) | zed(101, 13, 6) | zed(110, 2, 8),
    ]
    resting = 0.45
    return {
        "sleep0": pose(base, "closed", resting, fierce, sleep_z[0]),
        "sleep1": pose(base, "closed", resting, fierce, sleep_z[1]),
        "sleep2": pose(base, "closed", resting, fierce, sleep_z[2]),
        "idle": pose(base, "open", 1.0, fierce),
        "blink": pose(base, "blink", 1.0, fierce),
        "left": pose(base, "left", 1.0, fierce),
        "right": pose(base, "right", 1.0, fierce),
        "happy": pose(base, "happy", 1.15, fierce),
        "wide": pose(base, "wide", 1.2, fierce),
        "think0": pose(base, "up", 0.6, fierce, thinking_dots(1)),
        "think1": pose(base, "up", 0.6, fierce, thinking_dots(2)),
        "think2": pose(base, "up", 0.6, fierce, thinking_dots(3)),
        "talk0": pose(base, "open", 0.75, fierce, sound_arcs(1)),
        "talk1": pose(base, "open", 1.35, fierce, sound_arcs(2)),
        "talk2": pose(base, "happy", 1.0, fierce, sound_arcs(1)),
        "talk3": pose(base, "open", 0.45, fierce),
    }


class Canvas:
    """The grid every frame shares, trimmed to what any frame draws on."""

    def __init__(self, all_dots: set[Dot]) -> None:
        self.col0 = min(x for x, _ in all_dots) // 2
        self.col1 = max(x for x, _ in all_dots) // 2 + 1
        self.row0 = min(y for _, y in all_dots) // 4
        self.row1 = max(y for _, y in all_dots) // 4 + 1

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


def mega_color(gold_cells: set, red_cells: set, leaf_cells: set):
    def color_of(col: int, row: int) -> str:
        x, y = col * 2 + 1, row * 4 + 2
        if (col, row) in gold_cells:
            return GOLD
        if (col, row) in red_cells:
            return RED
        if (col, row) in leaf_cells:
            return LIME
        if 70 <= x <= 85 and 31 <= y <= 39:
            return GOLD
        if 56 <= x <= 86 and 41 <= y <= 60:
            return CREAM
        if y < 41:
            return LIME
        if x >= 112 and y >= 118:
            return DEEP_GREEN
        if x < 56 and 75 <= y <= 118:
            return LIME
        return GREEN
    return color_of


def build(widget_dir: Path = WIDGET_DIR) -> dict:
    base = read_dots(widget_dir / "base.txt")
    custom_mega = widget_dir / "mega.txt"
    leaves: set[Dot] = set()
    for points in MEGA_LEAVES:
        leaves |= polyline(points)
    bands: set[Dot] = set()
    for points in MEGA_TAIL_BANDS:
        bands |= polyline(points)
    gold: set[Dot] = set()
    for pod in MEGA_GOLD_PODS:
        gold |= disc(*pod)
    red: set[Dot] = bands.copy()
    for pod in MEGA_RED_PODS:
        red |= disc(*pod)
    custom = custom_mega.exists()
    mega_base = read_dots(custom_mega) if custom else base | leaves | gold | red

    mono = build_poses(base, fierce=False)
    mega = build_poses(mega_base, fierce=True)

    all_dots: set[Dot] = set()
    for dots in list(mono.values()) + list(mega.values()):
        all_dots |= dots
    canvas = Canvas(all_dots)

    color_of = (
        mega_color(set(), set(), set())
        if custom
        else mega_color(set(canvas.cells(gold)), set(canvas.cells(red)), set(canvas.cells(leaves)))
    )

    frames: dict[str, dict] = {}
    for name, dots in mono.items():
        frames[f"mono.{name}"] = {"rows": canvas.rows(dots)}
    for name, dots in mega.items():
        frames[f"mega.{name}"] = {"rows": canvas.rows(dots), "colors": canvas.colors(dots, color_of)}

    # Evolving: colour spreads while the new parts are drawn in, dot by dot.
    steps = 16
    rng = random.Random(3)
    reveal = {dot: rng.random() for dot in mega["idle"] | mono["idle"]}
    cell_reveal: dict[tuple[int, int], float] = {}
    evolve: list[dict] = []
    for step in range(1, steps + 1):
        progress = step / steps
        dots = (mono["idle"] & mega["idle"]) | {
            dot for dot in mega["idle"] - mono["idle"] if reveal[dot] < progress
        } | {dot for dot in mono["idle"] - mega["idle"] if reveal[dot] >= progress}

        def step_color(col: int, row: int, progress: float = progress) -> str:
            chance = cell_reveal.setdefault((col, row), rng.random())
            if chance < progress - 0.15:
                return color_of(col, row)
            return WHITE if chance < progress else GREY

        evolve.append({"rows": canvas.rows(dots), "colors": canvas.colors(dots, step_color)})

    return {
        "columns": canvas.col1 - canvas.col0,
        "rows": canvas.row1 - canvas.row0,
        "grey": GREY,
        "palette": {letter: color for color, letter in PALETTE_LETTERS.items()},
        "frames": frames,
        "evolve": evolve,
    }


def main() -> int:
    if not (WIDGET_DIR / "base.txt").exists():
        print(f"Put your Braille art at {WIDGET_DIR / 'base.txt'} first.", file=sys.stderr)
        return 1
    data = build()
    target = WIDGET_DIR / "frames.js"
    target.write_text(
        ".pragma library\nvar data = " + json.dumps(data, ensure_ascii=False) + ";\n",
        encoding="utf8",
    )
    print(f"{len(data['frames'])} frames, {data['columns']}x{data['rows']} cells, {target.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())

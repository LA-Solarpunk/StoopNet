#!/usr/bin/env python3
"""Subset and base64-encode local fonts into theme.css.

Obsidian theme CSS is loaded under app://obsidian.md/, so relative file URLs
in @font-face rules cannot reach the theme's fonts/ directory. The workaround
is to embed the fonts as data URIs. To keep the CSS small, each font is first
subsetted to a practical Latin glyph set.
"""

import base64
import os
import re
import sys
import tempfile
from pathlib import Path

from fontTools.subset import main as pyftsubset_main


# Glyph range covering Basic Latin, Latin-1 Supplement, Latin Extended-A,
# common punctuation, a few symbols, and the Nerd Font icon Private Use Areas.
UNICODES = (
    "U+0020-007E,U+00A0-00FF,U+0100-017F,U+2018-201F,U+2022,U+20AC,"
    "U+E000-EFFF,U+F000-FFFF,"               # Nerd Fonts PUA-A (icons)
    "U+F0000-FFFFF"                          # Nerd Fonts PUA-B/C (Material icons in NF v3+)
)

# Fonts to embed: (source file, font-family, font-weight, font-style)
FONTS = [
    # Roboto Condensed variable fonts
    ("fonts/RobotoCondensed-VariableFont_wght.ttf", "Roboto Condensed", "100 900", "normal"),
    ("fonts/RobotoCondensed-Italic-VariableFont_wght.ttf", "Roboto Condensed", "100 900", "italic"),
    # Atkynson Propo: body text
    ("fonts/AtkynsonMonoNerdFontPropo-Regular.otf", "Atkynson Mono Nerd Font Propo", "400", "normal"),
    ("fonts/AtkynsonMonoNerdFontPropo-Italic.otf", "Atkynson Mono Nerd Font Propo", "400", "italic"),
    ("fonts/AtkynsonMonoNerdFontPropo-Bold.otf", "Atkynson Mono Nerd Font Propo", "700", "normal"),
    ("fonts/AtkynsonMonoNerdFontPropo-BoldItalic.otf", "Atkynson Mono Nerd Font Propo", "700", "italic"),
    # Atkynson Mono: code / monospace
    ("fonts/AtkynsonMonoNerdFontMono-Regular.otf", "Atkynson Mono Nerd Font Mono", "400", "normal"),
    ("fonts/AtkynsonMonoNerdFontMono-Italic.otf", "Atkynson Mono Nerd Font Mono", "400", "italic"),
    ("fonts/AtkynsonMonoNerdFontMono-Bold.otf", "Atkynson Mono Nerd Font Mono", "700", "normal"),
    ("fonts/AtkynsonMonoNerdFontMono-BoldItalic.otf", "Atkynson Mono Nerd Font Mono", "700", "italic"),
]


def subset_font(src: Path, tmpdir: Path) -> Path:
    """Subset a font and return the path to the smaller file."""
    ext = src.suffix.lower()
    dst = tmpdir / f"{src.stem}-subset{ext}"
    args = [
        "pyftsubset",
        str(src),
        f"--unicodes={UNICODES}",
        f"--output-file={dst}",
    ]
    old_argv = sys.argv
    try:
        sys.argv = args
        pyftsubset_main()
    finally:
        sys.argv = old_argv
    return dst


def format_for_ext(ext: str) -> str:
    return "opentype" if ext == ".otf" else "truetype"


def build_css(tmpdir: Path) -> str:
    lines = ["/* ── Local font faces (embedded) ─────────────────────────── */", ""]
    for rel_path, family, weight, style in FONTS:
        src = Path(rel_path)
        if not src.exists():
            raise FileNotFoundError(f"Font not found: {src}")
        subset = subset_font(src, tmpdir)
        data = base64.b64encode(subset.read_bytes()).decode("ascii")
        fmt = format_for_ext(src.suffix.lower())
        lines.append("@font-face {")
        lines.append(f"  font-family: '{family}';")
        lines.append(f"  src: url('data:font/{fmt};base64,{data}') format('{fmt}');")
        lines.append(f"  font-weight: {weight};")
        lines.append(f"  font-style: {style};")
        lines.append("  font-display: swap;")
        lines.append("}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main():
    theme_path = Path("theme.css")
    original = theme_path.read_text(encoding="utf-8")

    with tempfile.TemporaryDirectory() as tmp:
        font_css = build_css(Path(tmp))

    # Replace the existing local-font-faces block (everything between the
    # marker comment and the .theme-dark block) with the embedded version.
    pattern = re.compile(
        r"/\* ── Local font faces.*?\n\n(?=\.theme-dark,)",
        re.DOTALL,
    )
    if not pattern.search(original):
        print("Could not find the local font faces block in theme.css", file=sys.stderr)
        sys.exit(1)

    updated = pattern.sub(font_css + "\n", original, count=1)
    theme_path.write_text(updated, encoding="utf-8")
    print(f"Updated {theme_path} with embedded fonts.")


if __name__ == "__main__":
    main()

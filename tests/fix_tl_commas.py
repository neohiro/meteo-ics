#!/usr/bin/env python3
"""Fix missing commas inside the T_L translation blocks of a meteo-ics file.

The battery/lint/deploy checks are note-parsers: they count brackets and match
regexes, but never parse JS. A real JS parse (esprima) exposed a genuine
defect: inside `const T_L = { ... }`, several keys were written as
`en:'...' zh:'...'` — object members with NO separating comma, which is invalid
ECMAScript and throws `SyntaxError: Unexpected identifier 'zh'` in Apps Script
(precisely the deployed symptom).

This one-shot fixer inserts a comma after a string literal ONLY where it is
immediately followed by a language key (en|zh|hi|es|fr|ar|de|nl): inside a T_L
block. It is intentionally conservative: valid `en:"...", zh:"..."` lines are
untouched.

Usage: python tests/fix_tl_commas.py [file ...]
(default: gcalweather.gs + icalweather.gs)
"""

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LANGS = ["en", "zh", "hi", "es", "fr", "ar", "de", "nl"]
LANG_ALT = "|".join(LANGS)
# string literal (single- or double-quoted, no inner escapes issues for our data)
STRING = r"(?:'(?:[^'\\]|\\')*'|\"(?:[^\"\\]|\\\")*\")"
# matches `'x'<ws>lang:` OR `"x"<ws>lang:` where lang is a known language key
BROKEN = re.compile(STRING + r"(?=\s+(?:" + LANG_ALT + r"):)", re.S)
# matches a `}` closing a value object that is immediately followed (after
# whitespace/newline) by another T_L key — i.e. a missing top-level separator
BROKEN_TOP = re.compile(r"\}(?=\s*\n\s*[A-Za-z_$][\w$]*\s*:)", re.M)


def find_tl_block(text: str):
    """Return (start_of_const, end_of_block) for the first `const T_L = {…};`."""
    m = re.search(r"const\s+T_L\s*=\s*\{", text)
    if m is None:
        return None
    start = m.start()
    depth = 0
    quotes = None
    i = text.index("{", start)
    n = len(text)
    while i < n:
        c = text[i]
        if quotes:
            if c == "\\":
                i += 2
                continue
            if c == quotes:
                quotes = None
            i += 1
            continue
        if c in "\"'`":
            quotes = c
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                if end < n and text[end] == ";":
                    end += 1
                return start, end
        i += 1
    return None


def fix_file(path: Path) -> int:
    text = path.read_text(encoding="utf-8")
    span = find_tl_block(text)
    if span is None:
        print(f"SKIP {path.name}: no T_L block found")
        return 0
    lo, hi = span
    block = text[lo:hi]
    fixed, n1 = BROKEN.subn(lambda m: m.group(0) + ",", block)
    fixed, n2 = BROKEN_TOP.subn(lambda m: m.group(0) + ",", fixed)
    text = text[:lo] + fixed + text[hi:]
    path.write_text(text, encoding="utf-8", newline="")
    print(f"FIX  {path.name}: inserted {n1} inner + {n2} top-level comma(s) in T_L block")
    return n1 + n2


def main(argv: list[str]) -> int:
    targets = argv or ["gcalweather.gs", "icalweather.gs"]
    total = 0
    for name in targets:
        p = REPO / name if Path(name).parent == Path(".") else Path(name)
        if not p.exists():
            print(f"FAIL {name}: file not found")
            return 1
        total += fix_file(p)
    print(f"FIX_TL_TOTAL={total}")
    return 0 if total >= 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
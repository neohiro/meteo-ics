"""
Lint Google Apps Script (.gs) source files for balanced braces, parens, and brackets.

Strips comments, single/double-quoted strings, and template literals (including
nested ${...} interpolations) so the count only reflects structural delimiters.

Usage:
    python tests/lint_balance.py [path1.gs path2.gs ...]
Defaults to gcalweather.gs and icalweather.gs at the repo root.
"""

import re
import sys
from pathlib import Path


def strip_non_code(src: str) -> str:
    """Remove comments and string literals from Apps Script source.

    Hand-written state machine so it correctly handles escape sequences, template
    literal interpolations (which may themselves contain strings), and a mix of
    quote styles.
    """
    out = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        # Line comment
        if c == "/" and nxt == "/":
            j = src.find("\n", i)
            if j == -1:
                break
            i = j
            continue
        # Block comment
        if c == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            if j == -1:
                break
            i = j + 2
            continue
        # String literals
        if c in ('"', "'"):
            quote = c
            out.append('""')
            i += 1
            while i < n:
                if src[i] == "\\" and i + 1 < n:
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        # Template literal
        if c == "`":
            out.append("``")
            i += 1
            while i < n:
                if src[i] == "\\" and i + 1 < n:
                    i += 2
                    continue
                if src[i] == "`":
                    i += 1
                    break
                # Interpolation: ${ ... }
                if src[i] == "$" and i + 1 < n and src[i + 1] == "{":
                    out.append("${")
                    i += 2
                    depth = 1
                    while i < n and depth > 0:
                        if src[i] == "{":
                            depth += 1
                        elif src[i] == "}":
                            depth -= 1
                            if depth == 0:
                                out.append("}")
                                i += 1
                                break
                        elif src[i] in ('"', "'", "`"):
                            # nested string inside interpolation
                            q = src[i]
                            out.append('""' if q != "`" else "``")
                            i += 1
                            while i < n:
                                if src[i] == "\\" and i + 1 < n:
                                    i += 2
                                    continue
                                if src[i] == q:
                                    i += 1
                                    break
                                i += 1
                            continue
                        i += 1
                    continue
                i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def lint_file(path: Path) -> tuple[bool, dict]:
    src = path.read_text(encoding="utf-8")
    cleaned = strip_non_code(src)
    counts = {ch: cleaned.count(ch) for ch in "(){}[]"}
    ok = (
        counts["("] == counts[")"]
        and counts["{"] == counts["}"]
        and counts["["] == counts["]"]
    )
    return ok, counts


def main() -> int:
    repo = Path(__file__).resolve().parent.parent
    targets = sys.argv[1:] or ["gcalweather.gs", "icalweather.gs"]
    failed = 0
    for name in targets:
        p = Path(name) if Path(name).is_absolute() else repo / name
        if not p.exists():
            print(f"{name}: NOT FOUND")
            failed += 1
            continue
        ok, counts = lint_file(p)
        print(f"{p.name}: {counts} -> {'OK' if ok else 'FAIL'}")
        if not ok:
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

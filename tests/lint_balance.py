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


_MODULE_LIT_RE = re.compile(
    r'^\s*(?:let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=',
    re.MULTILINE,
)


def collect_module_lets(path: Path) -> set[str]:
    """Return names declared at module scope with `let` or `var`. We use this to
    detect cross-file name collisions: if gcalweather.gs and icalweather.gs both
    declare the same leading-underscore name (e.g. _fetchAllImpl) and someone
    deploys them as a single Apps Script project, the second declaration shadows
    the first and the retry path silently uses the wrong fetcher.

    We restrict to underscore-prefixed names because those are the test seams
    deliberately exposed at module scope. Names without a leading underscore are
    intended public API (unique per file)."""
    src = path.read_text(encoding="utf-8")
    return {n for n in _MODULE_LIT_RE.findall(src) if n.startswith("_")}


def lint_cross_file_collision(paths: list[Path]) -> tuple[bool, list[str]]:
    name_sets = {p.name: collect_module_lets(p) for p in paths}
    collisions: list[tuple[str, str, str]] = []
    # Special-case: identical leading-underscore names that map to test seams
    # ARE the cross-file collision risk. Whitelist only the single-file seams
    # (none today) — every underscore-prefixed module-level let is a risk.
    underscore_names: dict[str, list[str]] = {}
    for fname, names in name_sets.items():
        for n in names:
            if n.startswith("_"):
                underscore_names.setdefault(n, []).append(fname)
    risky = {n: files for n, files in underscore_names.items() if len(files) > 1}
    ok = not risky
    report = []
    for n, files in sorted(risky.items()):
        report.append(f"COLLISION: '{n}' is `let`-declared at module scope in: {', '.join(files)}")
    return ok, report


def main() -> int:
    repo = Path(__file__).resolve().parent.parent
    targets = sys.argv[1:] or ["gcalweather.gs", "icalweather.gs"]
    failed = 0
    file_paths = []
    for name in targets:
        p = Path(name) if Path(name).is_absolute() else repo / name
        if not p.exists():
            print(f"{name}: NOT FOUND")
            failed += 1
            continue
        file_paths.append(p)
        ok, counts = lint_file(p)
        print(f"{p.name}: {counts} -> {'OK' if ok else 'FAIL'}")
        if not ok:
            failed += 1
    # Cross-file collision check when multiple .gs files are provided
    gs_paths = [p for p in file_paths if p.suffix == ".gs"]
    if len(gs_paths) > 1:
        ok2, report2 = lint_cross_file_collision(gs_paths)
        if not ok2:
            for line in report2:
                print(line)
            failed += 1
        else:
            underscore_names = {
                n: files
                for p in gs_paths
                for n in collect_module_lets(p)
                if n.startswith("_")
            }
            safe = {n: files for n, files in underscore_names.items()
                    if len(files) == 1}
            print(f"cross-file: {len(underscore_names)} underscore lets found, "
                  f"{len(safe)} safe (single-file), 0 collisions")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

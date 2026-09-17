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

try:
    import esprima  # optional: enables the real JS syntax gate
except ImportError:
    esprima = None

# Apps Script runs V8 (ES2020). The python esprima port stops at ES2019, so
# optional chaining / nullish coalescing are reported as false syntax errors.
# Shims map them onto equivalent ES2019 constructs for *syntax-gate* purposes
# only. They run on raw source, so they may match inside string/comment
# content, but each rewrite maps a token shape onto an equivalent token shape
# (never changing braces, parens, brackets, or commas), so they cannot inject
# or mask a structure-level syntax error. Order matters: bracket and call
# forms must be rewritten before the bare `?.` rewrite.
_ES2020_SHIMS = [
    (re.compile(r"\?\.\["), "["),                    # a?.[i] -> a[i]
    (re.compile(r"\?\.\("), "("),                    # a?.(...) -> a(...)
    (re.compile(r"\?\.([A-Za-z_$])"), r".\1"),       # a?.b -> a.b
    (re.compile(r"\?\?"), r"||"),                    # a ?? b -> a || b
]


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


def lint_syntax(path: Path) -> tuple[bool, str]:
    """Real JavaScript syntax gate via esprima (if installed).

    The brace/quote linter and the regex battery never parse JS, so a syntax
    error like `en:'...' zh:'...'` (missing comma between object members) can
    sneak past every other check yet still crash Apps Script at deploy time.
    When esprima is available, this is the authoritative parse.

    Returns (ok, detail). ok=False means the file has a genuine syntax error.
    """
    if esprima is None:
        return True, "esprima not installed; syntax gate skipped"
    src = path.read_text(encoding="utf-8")
    for pat, rep in _ES2020_SHIMS:
        src = pat.sub(rep, src)
    try:
        esprima.parseScript(src)
        return True, "JS syntax OK"
    except Exception as e:
        line = getattr(e, "lineNumber", "?")
        col = getattr(e, "column", "?")
        return False, f"JS syntax error at line {line}, col {col}: {str(e)[:90]}"


_MODULE_LIT_RE = re.compile(
    r'^(let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=',
    re.MULTILINE,
)


def collect_module_lets(path: Path) -> set[str]:
    """Return names declared at module scope with `let` or `var`. We use this to
    detect cross-file name collisions: if gcalweather.gs and icalweather.gs both
    declare the same leading-underscore name (e.g. _fetchAllImpl) and someone
    deploys them as a single Apps Script project, the second declaration shadows
    the first and the retry path silently uses the wrong fetcher.

    Module scope = column 0 of the source (no indentation). Variables inside
    IIFEs, function bodies, or any nested block are intentionally excluded
    because they are function-scoped and cannot collide across files.

    We restrict to underscore-prefixed names because those are the test seams
    deliberately exposed at module scope. Names without a leading underscore are
    intended public API (unique per file)."""
    src = path.read_text(encoding="utf-8")
    return {n for _, n in _MODULE_LIT_RE.findall(src) if n.startswith("_")}


def lint_cross_file_collision(paths: list[Path]) -> tuple[bool, list[str], dict[str, list[str]]]:
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
    return ok, report, underscore_names


# Constants that are intentionally mirrored across gcalweather.gs and icalweather.gs.
# If one file changes a value (e.g. AQ cap) and the other is forgotten, the
# deployed runtime behavior diverges silently because each Apps Script project
# uses only one of the two files. This regex catches drift.
_SHARED_CONST_RE = re.compile(
    r'^(const|let|var)\s+([A-Z][A-Z0-9_]+)\s*=\s*([^;{}\n]+?);',
    re.MULTILINE,
)


def collect_shared_constants(path: Path) -> dict[str, str]:
    """Return a dict of SCREAMING_SNAKE_CASE constants declared at module scope
    (column 0), mapped to their RHS string (stripped).

    Only top-level declarations are captured. Assignments inside functions or
    IIFEs are excluded. We restrict to UPPER_SNAKE_CASE names because those
    are the conventionally-shared API constants; mixedCase and camelCase
    constants are typically file-local."""
    src = path.read_text(encoding="utf-8")
    return {n: rhs.strip() for _, n, rhs in _SHARED_CONST_RE.findall(src)}


def lint_constant_drift(paths: list[Path]) -> tuple[bool, list[str]]:
    """Detect constants declared with the same name but different values across
    .gs files. Returns (ok, report). ok=False if any drift is found.

    Conservative by design: only flags a name as drifted if it appears in 2+
    files with different RHS values. Constants present in only one file are
    ignored (they may be file-local by design)."""
    constants: dict[str, dict[str, str]] = {}
    for p in paths:
        for n, rhs in collect_shared_constants(p).items():
            constants.setdefault(n, {})[p.name] = rhs
    drift: list[tuple[str, dict[str, str]]] = []
    for n, by_file in constants.items():
        if len(by_file) > 1 and len(set(by_file.values())) > 1:
            drift.append((n, by_file))
    report = []
    for n, by_file in sorted(drift):
        report.append(
            f"DRIFT: constant '{n}' has different values across files: "
            + ", ".join(f"{f}={v}" for f, v in sorted(by_file.items()))
        )
    return not drift, report


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
        ok4, detail4 = lint_syntax(p)
        print(f"{p.name}: {detail4}")
        if not ok4:
            failed += 1
    # Cross-file collision check when multiple .gs files are provided
    gs_paths = [p for p in file_paths if p.suffix == ".gs"]
    if len(gs_paths) > 1:
        ok2, report2, underscore_names = lint_cross_file_collision(gs_paths)
        if not ok2:
            for line in report2:
                print(line)
            failed += 1
        else:
            safe = {n: files for n, files in underscore_names.items()
                    if len(files) == 1}
            print(f"cross-file: {len(underscore_names)} underscore lets found, "
                  f"{len(safe)} safe (single-file), 0 collisions")
        # Constant drift check
        ok3, report3 = lint_constant_drift(gs_paths)
        if not ok3:
            for line in report3:
                print(line)
            failed += 1
        else:
            print(f"constant-drift: 0 shared-constant mismatches")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

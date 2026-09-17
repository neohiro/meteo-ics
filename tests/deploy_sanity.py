#!/usr/bin/env python3
"""Deploy-side sanity checker for meteo-ics.

The Apps-Script battery (tests/run_tests.py) validates the *repository* copies
of gcalweather.gs / icalweather.gs, but it can never see the human-pasted copy
inside a Google Apps Script project. The classic deploy-assembly failure — a
truncated import (entry file renamed to Code.gs, or a dropped line mid-paste)
that spills `zh:` out of the `const T_L = {` literal — only exists in the
deployed fileches, so no repo battery can catch it.

Run this to prove the assembly is intact. With no arguments it checks the
repository copies of gcalweather.gs / icalweather.gs; pass one or more file
paths to check a pasted/deployed copy instead (e.g. the file inside your Apps
Script project, before you click Save). Each file is verified for:

  1. The `const T_L = {` opener exists.
  2. A `zh:` translation key exists inside T_L (its loss is the classic
     `Unexpected identifier 'zh'` symptom).
  3. The T_L block is brace/bracket self-balanced (a dropped opener or a
     truncated tail would fail here).
  4. The AQI render line carries the qualitative label AND the glyph-tag
     `[${aqiType}]` (gcal) / `[${aqiTypeKey}]` (ical), lockstep with the battery.

Exit code: 0 = deploy-safe; 1 = assembly broken (paste error). No network,
no side effects, pure local validation.
"""

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

PAIRS = {
    "gcalweather.gs":   {"aqiVar": "aqiType"},
    "icalweather.gs":   {"aqiVar": "aqiTypeKey"},
}


def _balanced(block: str) -> bool:
    counts = {c: block.count(c) for c in "(){}[]"}
    return counts["("] == counts[")"] and counts["{"] == counts["}"] and counts["["] == counts["]"]


def _t_l_block(body: str):
    """Return the full `const T_L = { … };` block, balance-aware."""
    m = re.search(r'const\s+T_L\s*=\s*\{', body)
    if m is None:
        return None
    start = m.start()
    depth = 0
    i = body.index("{", start)
    n = len(body)
    quotes = None
    while i < n:
        c = body[i]
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
                # include trailing `;` if present
                end = i + 1
                if end < n and body[end] == ";":
                    return body[start : end + 1]
                return body[start : end + 1]
        i += 1
    return None


def check(path: Path, aqiTypeVar: str) -> list[str]:
    errs: list[str] = []
    body = path.read_text(encoding="utf-8")

    # 1. Opener present.
    if re.search(r'const\s+T_L\s*=\s*\{', body) is None:
        errs.append(f"{path.name}: missing `const T_L = {{` opener")

    # 2. `zh:` key inside T_L.
    block = _t_l_block(body)
    if block is None:
        errs.append(f"{path.name}: T_L block not extractable (dropped opener/tail?)")
    else:
        if re.search(r'\bzh\s*:', block) is None:
            errs.append(f"{path.name}: T_L has no `zh:` key — the classic 'Unexpected identifier zh' deploy symptom")
        # 3. Self-balance.
        if not _balanced(block):
            errs.append(f"{path.name}: T_L block brace/bracket imbalance")

    # 4. Glyph-tag parity twin.
    glyph_tag = r'getAqiLabel\([^\n]*\)[^\n]*\[\$\{' + aqiTypeVar + r'\}\]'
    if re.search(glyph_tag, body) is None:
        errs.append(f"{path.name}: AQI line must render (label) [${aqiTypeVar}] glyph-tag")
    return errs


def main(argv: list[str]) -> int:
    failed = 0
    targets = argv or list(PAIRS)
    for name in targets:
        p = REPO / name if Path(name).parent == Path(".") and (REPO / name).exists() else Path(name)
        if not p.exists():
            print(f"FAIL {name}: file not found")
            failed += 1
            continue
        aqi_var = PAIRS.get(p.name, {}).get("aqiVar", "aqiType")
        errs = check(p, aqi_var)
        if errs:
            failed += 1
            for e in errs:
                print(f"FAIL {name}: {e}")
        else:
            print(f"OK   {name}: T_L opener/zh/balance + glyph-tag parity intact")
    print(f"DEPLOY_SANITY_EXIT={1 if failed else 0}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
